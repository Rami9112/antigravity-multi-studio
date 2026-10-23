import http from 'node:http';
import { CLOUD_CODE_PRIMARY_ORIGIN } from '../constants.js';
import type { AccountProfile } from '../types.js';
import {
  buildClientMetadataHeader,
  buildHubUserAgent,
  rewriteCloudCodePayloadMetadata,
} from '../utils/fingerprint.js';
import { forwardStreamViaProxy } from './proxy-agent.js';

export interface StealthGatewayOptions {
  profile: AccountProfile;
  upstreamOrigin?: string;
  getValidAccessToken?: (profileId: string) => Promise<string | undefined>;
}

const TELEMETRY_PATH_PATTERNS = [
  /^\/log\b/i,
  /:recordTelemetry\b/i,
  /:recordAnalytics\b/i,
  /:uploadPerformanceProfile\b/i,
];

const STRIPPED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'x-forwarded-for',
  'x-real-ip',
  'via',
  'forwarded',
]);

export class ProfileStealthGateway {
  private server: http.Server | null = null;
  private boundPort = 0;
  private profile: AccountProfile;
  private readonly upstreamOrigin: string;
  private readonly getValidAccessToken?: (profileId: string) => Promise<string | undefined>;

  public interceptedRequests = 0;
  public blockedTelemetryRequests = 0;
  public lastActivityAt?: string;

  constructor(options: StealthGatewayOptions) {
    this.profile = options.profile;
    this.upstreamOrigin = (options.upstreamOrigin ?? CLOUD_CODE_PRIMARY_ORIGIN).replace(/\/+$/, '');
    this.getValidAccessToken = options.getValidAccessToken;
  }

  public updateProfile(profile: AccountProfile): void {
    this.profile = profile;
  }

  public get port(): number {
    return this.boundPort;
  }

  public get url(): string {
    return `http://127.0.0.1:${this.boundPort}`;
  }

  public async start(preferredPort = 0): Promise<number> {
    if (this.server) {
      return this.boundPort;
    }

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(preferredPort, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to bind ProfileStealthGateway port'));
          return;
        }
        this.boundPort = addr.port;
        this.server = server;
        resolve();
      });
    });

    return this.boundPort;
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    srv.closeAllConnections();
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const reqUrl = req.url ?? '/';
    this.lastActivityAt = new Date().toISOString();

    if (reqUrl === '/__anti_multi/health') {
      const payload = JSON.stringify({
        ok: true,
        profileId: this.profile.id,
        profileName: this.profile.name,
        installationId: this.profile.fingerprint.installationId,
        spoofedUserAgent: buildHubUserAgent(this.profile.fingerprint),
        interceptedRequests: this.interceptedRequests,
        blockedTelemetryRequests: this.blockedTelemetryRequests,
        lastActivityAt: this.lastActivityAt,
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }

    if (
      this.profile.fingerprint.blockTelemetry &&
      TELEMETRY_PATH_PATTERNS.some((re) => re.test(reqUrl))
    ) {
      this.blockedTelemetryRequests += 1;
      const body = '{}';
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    this.interceptedRequests += 1;

    try {
      const rawBody = await readRequestBody(req);
      let outboundBody: Buffer = rawBody;

      const contentType = String(req.headers['content-type'] ?? '');
      if (rawBody.length > 0 && contentType.toLowerCase().includes('application/json')) {
        try {
          const parsed = JSON.parse(rawBody.toString('utf8'));
          const rewritten = rewriteCloudCodePayloadMetadata(
            parsed,
            this.profile.fingerprint,
            this.profile.account?.projectId,
          );
          outboundBody = Buffer.from(JSON.stringify(rewritten), 'utf8');
        } catch {
          outboundBody = rawBody;
        }
      }

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (STRIPPED_HEADERS.has(k.toLowerCase())) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : v;
      }

      // 1. Spoof User-Agent and Client-Metadata to match this profile's isolated device fingerprint
      headers['user-agent'] = buildHubUserAgent(this.profile.fingerprint);
      delete headers['User-Agent'];
      headers['client-metadata'] = buildClientMetadataHeader(this.profile.fingerprint);
      delete headers['Client-Metadata'];

      // 2. Force account OAuth token isolation
      let accessToken = this.profile.account?.accessToken;
      if (this.getValidAccessToken) {
        const refreshed = await this.getValidAccessToken(this.profile.id);
        if (refreshed) {
          accessToken = refreshed;
        }
      }
      if (accessToken) {
        headers['authorization'] = `Bearer ${accessToken}`;
        delete headers['Authorization'];
      }

      const targetUrl = `${this.upstreamOrigin}${reqUrl.startsWith('/') ? reqUrl : `/${reqUrl}`}`;

      await forwardStreamViaProxy(
        {
          url: targetUrl,
          method: req.method ?? 'POST',
          headers,
          body: outboundBody.length > 0 ? outboundBody : undefined,
          proxy: this.profile.proxy.enabled ? this.profile.proxy : undefined,
          timeoutMs: 120000,
        },
        res,
      );
    } catch (err) {
      if (!res.headersSent) {
        const errBody = JSON.stringify({
          error: {
            code: 502,
            message: `StealthGateway upstream error: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        res.writeHead(502, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(errBody),
        });
        res.end(errBody);
      } else {
        res.end();
      }
    }
  }
}

function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
