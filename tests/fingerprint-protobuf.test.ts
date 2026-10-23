import { describe, expect, it } from 'vitest';
import {
  buildClientMetadataHeader,
  buildHubUserAgent,
  buildIdeUserAgent,
  formatProxyUrl,
  generateDeviceFingerprint,
  parseProxyString,
  rewriteCloudCodePayloadMetadata,
} from '../src/utils/fingerprint.js';
import {
  decodeUnifiedStateOAuthTokenBase64,
  encodeUnifiedStateOAuthTokenBase64,
  parseJetskiStoredTokenJson,
  toJetskiStoredTokenJson,
} from '../src/utils/protobuf.js';
import type { OAuthTokenData } from '../src/types.js';

describe('fingerprint utilities', () => {
  it('generates distinct device fingerprints for each profile', () => {
    const fp1 = generateDeviceFingerprint();
    const fp2 = generateDeviceFingerprint();

    expect(fp1.installationId).not.toBe(fp2.installationId);
    expect(fp1.machineId).toMatch(/^auth0\|user_[0-9a-f]{32}$/);
    expect(fp2.machineId).toMatch(/^auth0\|user_[0-9a-f]{32}$/);
    expect(fp1.machineId).not.toBe(fp2.machineId);
    expect(fp1.sqmId).toMatch(/^\{[0-9A-F-]{36}\}$/);
    expect(fp1.serviceMachineId).toBe(fp1.devDeviceId);
    expect(fp1.updaterId).not.toBe(fp2.updaterId);
  });

  it('builds official Hub and IDE User-Agent strings and Client-Metadata headers', () => {
    const fp = generateDeviceFingerprint({
      osType: 'windows',
      arch: 'arm64',
      hubVersion: '2.23.1',
      hubCl: '998881661',
      ideVersion: '4.3.0',
      installationId: '11111111-2222-4333-8444-555555555555',
    });

    expect(buildHubUserAgent(fp)).toBe(
      'antigravity/hub/2.23.1 (aidev_client; os_type=windows; arch=arm64; cl=998881661)',
    );
    expect(buildIdeUserAgent(fp)).toContain('Antigravity/4.3.0 (Windows NT 10.0; ARM64)');
    expect(buildClientMetadataHeader(fp)).toContain(
      'platform=WINDOWS_ARM64,pluginType=CLOUD_CODE',
    );
  });

  it('rewrites Cloud Code payload metadata with spoofed installationId and projectId', () => {
    const fp = generateDeviceFingerprint({
      installationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      hubVersion: '2.23.1',
    });

    const input = {
      project: '',
      model: 'models/gemini-3.5-pro',
      metadata: {
        ideType: 'ANTIGRAVITY',
        installationId: 'host-real-installation-id',
        ideVersion: '2.20.0',
      },
    };

    const rewritten = rewriteCloudCodePayloadMetadata(input, fp, 'my-cloud-project') as Record<
      string,
      unknown
    >;
    expect(rewritten.project).toBe('my-cloud-project');
    const meta = rewritten.metadata as Record<string, unknown>;
    expect(meta.installationId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(meta.ideVersion).toBe('2.23.1');
    expect(meta.duetProject).toBe('my-cloud-project');
  });

  it('parses and formats HTTP and SOCKS5 proxy strings', () => {
    const socks = parseProxyString('socks5://alice:secret@198.51.100.7:1080');
    expect(socks).toEqual({
      enabled: true,
      protocol: 'socks5',
      host: '198.51.100.7',
      port: 1080,
      username: 'alice',
      password: 'secret',
    });
    expect(formatProxyUrl(socks, true)).toBe('socks5://alice:secret@198.51.100.7:1080');
    expect(formatProxyUrl(socks, false)).toBe('socks5://198.51.100.7:1080');

    const colonFormat = parseProxyString('203.0.113.9:8888:bob:pw123');
    expect(colonFormat).toEqual({
      enabled: true,
      protocol: 'http',
      host: '203.0.113.9',
      port: 8888,
      username: 'bob',
      password: 'pw123',
    });
  });
});

describe('protobuf & token serialization utilities', () => {
  it('round-trips UnifiedStateSync OAuthTokenInfo protobuf base64', () => {
    const sample: OAuthTokenData = {
      accessToken: 'ya29.a0AfH6SMBx-test-access',
      refreshToken: '1//0gTestRefreshToken',
      expiryTimestamp: 1790000000,
      tokenType: 'Bearer',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20ifQ.sig',
      email: 'user@example.com',
    };

    const encoded = encodeUnifiedStateOAuthTokenBase64(sample);
    const decoded = decodeUnifiedStateOAuthTokenBase64(encoded);

    expect(decoded).toEqual({
      accessToken: sample.accessToken,
      refreshToken: sample.refreshToken,
      tokenType: 'Bearer',
      expiryTimestamp: 1790000000,
      idToken: sample.idToken,
    });
  });

  it('round-trips Jetski standalone OAuth token JSON and extracts JWT claims', () => {
    const payloadB64 = Buffer.from(
      JSON.stringify({ email: 'alpha@example.com', name: 'Alpha User' }),
      'utf8',
    ).toString('base64url');
    const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${payloadB64}.sig`;

    const sample: OAuthTokenData = {
      accessToken: 'ya29.access_1',
      refreshToken: '1//0g_refresh_1',
      expiryTimestamp: 1800000000,
      tokenType: 'Bearer',
      idToken: fakeJwt,
      email: 'alpha@example.com',
      projectId: 'cloudaicompanion-123',
    };

    const jsonObj = toJetskiStoredTokenJson(sample);
    const parsed = parseJetskiStoredTokenJson(JSON.stringify(jsonObj));

    expect(parsed?.accessToken).toBe('ya29.access_1');
    expect(parsed?.refreshToken).toBe('1//0g_refresh_1');
    expect(parsed?.expiryTimestamp).toBe(1800000000);
    expect(parsed?.email).toBe('alpha@example.com');
    expect(parsed?.name).toBe('Alpha User');
    expect(parsed?.projectId).toBe('cloudaicompanion-123');
  });
});
