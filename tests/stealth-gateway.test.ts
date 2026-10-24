import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { checkOutboundIp } from '../src/gateway/ip-checker.js';
import { requestViaProxy } from '../src/gateway/proxy-agent.js';
import { ProfileStealthGateway } from '../src/gateway/stealth-gateway.js';
import type { AccountProfile } from '../src/types.js';
import { createDefaultProxyConfig, generateDeviceFingerprint } from '../src/utils/fingerprint.js';

function makeTestProfile(
  id: string,
  email: string,
  accessToken: string,
  installationId: string,
  projectId: string,
  osType: 'windows' | 'darwin' = 'windows',
): AccountProfile {
  return {
    id,
    name: `Profile ${id}`,
    color: '#6366f1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    account: {
      accessToken,
      refreshToken: `refresh-${id}`,
      expiryTimestamp: Math.floor(Date.now() / 1000) + 3600,
      tokenType: 'Bearer',
      email,
      projectId,
    },
    fingerprint: generateDeviceFingerprint({
      installationId,
      osType,
      arch: 'arm64',
      hubVersion: '2.23.1',
      hubCl: '998881661',
      blockTelemetry: true,
    }),
    proxy: createDefaultProxyConfig(),
  };
}

describe('ProfileStealthGateway & IP Checker', () => {
  const serversToClose: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    while (serversToClose.length > 0) {
      const s = serversToClose.pop();
      if (s) await s.stop();
    }
  });

  it('isolates tokens and rewrites device fingerprints concurrently across multiple gateways', async () => {
    const receivedByUpstream: Array<{
      path: string;
      headers: http.IncomingHttpHeaders;
      body: Record<string, unknown>;
    }> = [];

    const mockUpstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        receivedByUpstream.push({
          path: req.url ?? '/',
          headers: req.headers,
          body,
        });
        const reply = JSON.stringify({ ok: true, echoedProject: body.project });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(reply);
      });
    });

    await new Promise<void>((resolve) => mockUpstream.listen(0, '127.0.0.1', () => resolve()));
    const upstreamPort = (mockUpstream.address() as { port: number }).port;
    serversToClose.push({
      stop: () => new Promise<void>((resolve) => mockUpstream.close(() => resolve())),
    });

    const profileA = makeTestProfile(
      'prof-a',
      'userA@example.com',
      'ya29.token_A_isolated',
      '11111111-aaaa-4111-8111-111111111111',
      'proj-alpha',
      'windows',
    );
    const profileB = makeTestProfile(
      'prof-b',
      'userB@example.com',
      'ya29.token_B_isolated',
      '22222222-bbbb-4222-8222-222222222222',
      'proj-beta',
      'darwin',
    );

    const gatewayA = new ProfileStealthGateway({
      profile: profileA,
      upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    });
    const gatewayB = new ProfileStealthGateway({
      profile: profileB,
      upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    });

    await gatewayA.start();
    await gatewayB.start();
    serversToClose.push(gatewayA, gatewayB);

    // Send concurrent requests through both gateways with leaked host credentials/IDs
    const [resA, resB] = await Promise.all([
      requestViaProxy({
        url: `${gatewayA.url}/v1internal:loadCodeAssist`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer leaked-global-keyring-token',
          'User-Agent': 'leaked-host-ua',
        },
        body: JSON.stringify({
          project: '',
          metadata: {
            ideType: 'ANTIGRAVITY',
            installationId: 'leaked-host-install-id',
          },
        }),
      }),
      requestViaProxy({
        url: `${gatewayB.url}/v1internal:loadCodeAssist`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer leaked-global-keyring-token',
          'User-Agent': 'leaked-host-ua',
        },
        body: JSON.stringify({
          project: '',
          metadata: {
            ideType: 'ANTIGRAVITY',
            installationId: 'leaked-host-install-id',
          },
        }),
      }),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(receivedByUpstream).toHaveLength(2);

    const reqA = receivedByUpstream.find(
      (r) => r.headers.authorization === 'Bearer ya29.token_A_isolated',
    );
    const reqB = receivedByUpstream.find(
      (r) => r.headers.authorization === 'Bearer ya29.token_B_isolated',
    );

    expect(reqA).toBeDefined();
    expect(reqA?.headers['user-agent']).toContain('os_type=windows');
    expect(reqA?.headers['client-metadata']).toContain(
      'platform=WINDOWS_ARM64,pluginType=CLOUD_CODE',
    );
    expect((reqA?.body.metadata as Record<string, unknown>).installationId).toBe(
      '11111111-aaaa-4111-8111-111111111111',
    );
    expect(reqA?.body.project).toBe('proj-alpha');

    expect(reqB).toBeDefined();
    expect(reqB?.headers['user-agent']).toContain('os_type=darwin');
    expect(reqB?.headers['client-metadata']).toContain(
      'platform=DARWIN_ARM64,pluginType=CLOUD_CODE',
    );
    expect((reqB?.body.metadata as Record<string, unknown>).installationId).toBe(
      '22222222-bbbb-4222-8222-222222222222',
    );
    expect(reqB?.body.project).toBe('proj-beta');

    // Verify telemetry blocking across all language_server.exe telemetry endpoints
    for (const telemetryPath of [
      '/log',
      '/v1internal:recordTrajectoryAnalytics',
      '/v1internal:recordClientEvent',
      '/v1internal:recordCodeAssistMetrics',
      '/v1internal:uploadPerformanceProfile',
    ]) {
      const telemetryRes = await requestViaProxy({
        url: `${gatewayA.url}${telemetryPath}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"events":[]}',
      });
      expect(telemetryRes.statusCode).toBe(200);
    }
    expect(gatewayA.blockedTelemetryRequests).toBe(5);
    expect(receivedByUpstream).toHaveLength(2); // did not hit upstream!
  });

  it('rewrites gzipped JSON payloads and fails fast on prematurely closed proxy sockets', async () => {
    let upstreamDecodedBody: Record<string, unknown> = {};
    const mockUpstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBuf = Buffer.concat(chunks);
        const unzipped =
          req.headers['content-encoding'] === 'gzip'
            ? zlib.gunzipSync(rawBuf)
            : rawBuf;
        upstreamDecodedBody = JSON.parse(unzipped.toString('utf8')) as Record<
          string,
          unknown
        >;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });

    await new Promise<void>((resolve) =>
      mockUpstream.listen(0, '127.0.0.1', () => resolve()),
    );
    const upstreamPort = (mockUpstream.address() as { port: number }).port;
    serversToClose.push({
      stop: () => new Promise<void>((resolve) => mockUpstream.close(() => resolve())),
    });

    const profile = makeTestProfile(
      'prof-gzip',
      'gzip@example.com',
      'ya29.gzip_token',
      '33333333-cccc-4333-8333-333333333333',
      'proj-gzip',
      'darwin',
    );
    const gateway = new ProfileStealthGateway({
      profile,
      upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    });
    await gateway.start();
    serversToClose.push(gateway);

    const compressedBody = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          installationId: 'leaked-top-level-id',
          metadata: {
            ideType: 'ANTIGRAVITY',
            platform: 'WINDOWS_AMD64',
            installationId: 'leaked-meta-id',
          },
        }),
        'utf8',
      ),
    );

    const res = await requestViaProxy({
      url: `${gateway.url}/v1internal:streamGenerateContent?alt=sse`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      body: compressedBody,
    });
    expect(res.statusCode).toBe(200);
    expect(upstreamDecodedBody.installationId).toBe(
      '33333333-cccc-4333-8333-333333333333',
    );
    const meta = upstreamDecodedBody.metadata as Record<string, unknown>;
    expect(meta.installationId).toBe('33333333-cccc-4333-8333-333333333333');
    expect(meta.platform).toBe('DARWIN_ARM64');
    expect(meta.duetProject).toBe('proj-gzip');

    // Verify premature proxy socket close fails immediately instead of hanging
    const deadProxy = net.createServer((socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      deadProxy.listen(0, '127.0.0.1', () => resolve()),
    );
    const deadProxyPort = (deadProxy.address() as { port: number }).port;
    serversToClose.push({
      stop: () => new Promise<void>((resolve) => deadProxy.close(() => resolve())),
    });

    await expect(
      requestViaProxy({
        url: 'https://example.com/test',
        proxy: {
          enabled: true,
          protocol: 'socks5',
          host: '127.0.0.1',
          port: deadProxyPort,
        },
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/SOCKS5|closed|ECONNRESET/i);
  });

  it('checks outbound IP against configured endpoints', async () => {
    const mockIpServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ip: '198.51.100.42',
          country: 'KR',
          city: 'Seoul',
          org: 'AS4766 Korea Telecom',
        }),
      );
    });

    await new Promise<void>((resolve) => mockIpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (mockIpServer.address() as { port: number }).port;
    serversToClose.push({
      stop: () => new Promise<void>((resolve) => mockIpServer.close(() => resolve())),
    });

    const result = await checkOutboundIp(undefined, {
      endpoints: [`http://127.0.0.1:${port}/json`],
    });

    expect(result.ok).toBe(true);
    expect(result.ip).toBe('198.51.100.42');
    expect(result.country).toBe('KR');
    expect(result.org).toBe('AS4766 Korea Telecom');
    expect(result.viaProxy).toBe(false);
  });
});
