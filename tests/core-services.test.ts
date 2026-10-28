import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDefaultAntigravityExecutableCandidates,
  resolveAntigravityExecutablePath,
} from '../src/constants.js';
import { detectLocalHostAntigravityAccount } from '../src/core/local-importer.js';
import {
  buildGoogleOAuthUrl,
  exchangeOAuthCode,
  refreshOAuthToken,
} from '../src/core/oauth-service.js';
import { ProfileStore } from '../src/core/profile-store.js';
import { fetchAccountQuota } from '../src/core/quota-service.js';
import type { OAuthTokenData } from '../src/types.js';
import { generateDeviceFingerprint } from '../src/utils/fingerprint.js';
import {
  encodeUnifiedStateOAuthTokenBase64,
  toJetskiStoredTokenJson,
} from '../src/utils/protobuf.js';

describe('ProfileStore, OAuthService, QuotaService, and LocalImporter', () => {
  const tempDirs: string[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      if (s) await new Promise<void>((r) => s.close(() => r()));
    }
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('persists profiles, regenerates fingerprints, and imports/exports bundles', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-multi-store-'));
    tempDirs.push(dir);

    const store = new ProfileStore(dir);
    const p1 = store.createProfile({ name: 'Account Alpha' });
    const p2 = store.createProfile({ name: 'Account Beta' });

    expect(p1.id).not.toBe(p2.id);
    expect(p1.fingerprint.installationId).not.toBe(p2.fingerprint.installationId);

    const oldInstallId = p1.fingerprint.installationId;
    const regenerated = store.regenerateFingerprint(p1.id, { osType: 'darwin' });
    expect(regenerated.fingerprint.installationId).not.toBe(oldInstallId);
    expect(regenerated.fingerprint.osType).toBe('darwin');

    // Reload from disk to verify persistence
    const storeReloaded = new ProfileStore(dir);
    expect(storeReloaded.listProfiles()).toHaveLength(2);
    expect(storeReloaded.getProfile(p1.id)?.fingerprint.installationId).toBe(
      regenerated.fingerprint.installationId,
    );

    // Verify proxy lastCheckedIp invalidation when proxy host/port changes
    const withCheckedIp = storeReloaded.updateProfile(p1.id, {
      proxy: {
        enabled: true,
        protocol: 'http',
        host: '10.0.0.1',
        port: 8080,
        lastCheckedIp: '203.0.113.10',
        lastCheckedCountry: 'US',
      },
    });
    expect(withCheckedIp.proxy.lastCheckedIp).toBe('203.0.113.10');

    const afterProxyChange = storeReloaded.updateProfile(p1.id, {
      proxy: {
        enabled: true,
        protocol: 'socks5',
        host: '10.0.0.2',
        port: 1080,
      },
    });
    expect(afterProxyChange.proxy.lastCheckedIp).toBeUndefined();
    expect(afterProxyChange.proxy.lastCheckedCountry).toBeUndefined();

    // Verify Antigravity-Manager top-level refresh_token import compatibility
    const imported = storeReloaded.importProfiles([
      {
        name: 'Manager Account',
        email: 'manager@example.com',
        refresh_token: '1//0g-manager-token',
      } as Record<string, unknown>,
    ]);
    expect(imported).toHaveLength(1);
    expect(imported[0]?.account?.refreshToken).toBe('1//0g-manager-token');
    expect(imported[0]?.account?.email).toBe('manager@example.com');
  });

  it('exchanges OAuth codes, refreshes tokens, and fetches quota from Cloud Code endpoints', async () => {
    const jwtClaims = Buffer.from(
      JSON.stringify({ email: 'pro-user@example.com', name: 'Pro User' }),
      'utf8',
    ).toString('base64url');
    const mockIdToken = `eyJhbGciOiJSUzI1NiJ9.${jwtClaims}.sig`;

    const mockServer = http.createServer((req, res) => {
      const url = req.url ?? '/';
      res.setHeader('Content-Type', 'application/json');

      if (url === '/token') {
        res.end(
          JSON.stringify({
            access_token: 'ya29.fresh-access-token',
            refresh_token: '1//0g-fresh-refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
            id_token: mockIdToken,
          }),
        );
        return;
      }

      if (url === '/v1internal:loadCodeAssist') {
        res.end(
          JSON.stringify({
            cloudaicompanionProject: 'companion-project-999',
            paidTier: { id: 'g1-pro-tier', name: 'Google One AI Pro' },
          }),
        );
        return;
      }

      if (url === '/v1internal:retrieveUserQuotaSummary') {
        res.end(
          JSON.stringify({
            groups: [
              {
                displayName: 'Claude & Opus',
                buckets: [
                  {
                    displayName: '5h Window',
                    remainingFraction: 0.82,
                    window: '18000s',
                    resetTime: '2026-10-24T06:00:00Z',
                  },
                ],
              },
            ],
          }),
        );
        return;
      }

      if (url === '/v1internal:fetchAvailableModels') {
        res.end(
          JSON.stringify({
            models: {
              'gemini-3.5-pro': {
                displayName: 'Gemini 3.5 Pro',
                quotaInfo: {
                  remainingFraction: 0.95,
                  resetTime: '2026-10-24T06:00:00Z',
                },
              },
            },
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.end('{}');
    });

    await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', () => r()));
    servers.push(mockServer);
    const port = (mockServer.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const authUrl = buildGoogleOAuthUrl('http://127.0.0.1:4300/api/oauth/callback', 'state123');
    expect(authUrl).toContain('access_type=offline');
    expect(authUrl).toContain('state=state123');

    const tokenData = await exchangeOAuthCode('code-abc', 'http://127.0.0.1:4300/cb', {
      tokenEndpoint: `${baseUrl}/token`,
    });
    expect(tokenData.email).toBe('pro-user@example.com');
    expect(tokenData.accessToken).toBe('ya29.fresh-access-token');

    const refreshed = await refreshOAuthToken('1//0g-refresh', tokenData, {
      tokenEndpoint: `${baseUrl}/token`,
    });
    expect(refreshed.accessToken).toBe('ya29.fresh-access-token');

    const fp = generateDeviceFingerprint();
    const quota = await fetchAccountQuota(refreshed, fp, {
      origins: [baseUrl],
    });
    expect(quota.tier).toBe('PRO');
    expect(quota.projectId).toBe('companion-project-999');
    expect(quota.groups[0]?.remainingPercent).toBe(82);
    expect(quota.models[0]?.remainingPercent).toBe(95);
  });

  it('imports local host accounts from jetski file store and state.vscdb', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-multi-home-'));
    tempDirs.push(tempHome);

    const sampleAccount: OAuthTokenData = {
      accessToken: 'ya29.local-host-token',
      refreshToken: '1//0g-local-host-refresh',
      expiryTimestamp: 1800000000,
      tokenType: 'Bearer',
      email: 'local@example.com',
    };

    // 1. Test state.vscdb detection
    const appData = path.join(tempHome, 'AppData', 'Roaming');
    const globalStorageDir = path.join(appData, 'Antigravity', 'User', 'globalStorage');
    fs.mkdirSync(globalStorageDir, { recursive: true });
    const vscdbPath = path.join(globalStorageDir, 'state.vscdb');

    const db = new DatabaseSync(vscdbPath);
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
      'antigravityUnifiedStateSync.oauthToken',
      encodeUnifiedStateOAuthTokenBase64(sampleAccount),
    );
    db.close();

    const fromVscdb = detectLocalHostAntigravityAccount({
      homeDir: tempHome,
      appDataDir: appData,
      keyringJsonOverride: null,
    });
    expect(fromVscdb?.source).toBe('state-vscdb');
    expect(fromVscdb?.account.refreshToken).toBe('1//0g-local-host-refresh');

    // 2. Test jetski-standalone-oauth-token detection
    const geminiDir = path.join(tempHome, '.gemini');
    fs.mkdirSync(path.join(geminiDir, 'antigravity'), { recursive: true });
    fs.writeFileSync(
      path.join(geminiDir, 'antigravity', 'installation_id'),
      '99999999-8888-4777-8666-555555555555',
      'utf8',
    );
    fs.writeFileSync(
      path.join(geminiDir, 'jetski-standalone-oauth-token'),
      JSON.stringify(toJetskiStoredTokenJson(sampleAccount)),
      'utf8',
    );

    const fromJetski = detectLocalHostAntigravityAccount({
      homeDir: tempHome,
      appDataDir: appData,
      keyringJsonOverride: null,
    });
    expect(fromJetski?.source).toBe('jetski-file-store');
    expect(fromJetski?.hostInstallationId).toBe('99999999-8888-4777-8666-555555555555');
    expect(fromJetski?.account.accessToken).toBe('ya29.local-host-token');

    // 3. Test macOS Application Support state.vscdb & .app bundle resolution
    const macHome = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-multi-mac-'));
    tempDirs.push(macHome);
    const macStorageDir = path.join(
      macHome,
      'Library',
      'Application Support',
      'Antigravity',
      'User',
      'globalStorage',
    );
    fs.mkdirSync(macStorageDir, { recursive: true });
    fs.copyFileSync(vscdbPath, path.join(macStorageDir, 'state.vscdb'));

    const fromMac = detectLocalHostAntigravityAccount({
      homeDir: macHome,
      appDataDir: path.join(macHome, 'nonexistent'),
      keyringJsonOverride: null,
    });
    expect(fromMac?.source).toBe('state-vscdb');
    expect(fromMac?.account.refreshToken).toBe('1//0g-local-host-refresh');

    const fakeAppBundle = path.join(macHome, 'Applications', 'Antigravity.app');
    const fakeMacBinary = path.join(fakeAppBundle, 'Contents', 'MacOS', 'Antigravity');
    fs.mkdirSync(path.dirname(fakeMacBinary), { recursive: true });
    fs.writeFileSync(fakeMacBinary, '#!/bin/sh\n', 'utf8');

    expect(resolveAntigravityExecutablePath(fakeAppBundle, 'darwin', macHome)).toBe(
      fakeMacBinary,
    );
    expect(
      getDefaultAntigravityExecutableCandidates('darwin', '/Users/test').some((p) =>
        p.includes('/Applications/Antigravity.app/Contents/MacOS/Antigravity'),
      ),
    ).toBe(true);
    expect(
      getDefaultAntigravityExecutableCandidates('linux', '/home/test').some((p) =>
        p.includes('/usr/bin/antigravity'),
      ),
    ).toBe(true);
  });
});
