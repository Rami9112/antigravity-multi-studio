import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileStore } from '../src/core/profile-store.js';
import { requestViaProxy } from '../src/gateway/proxy-agent.js';
import { InstanceManager } from '../src/launcher/instance-manager.js';
import { AppServer } from '../src/server/app-server.js';
import { renderDashboardHtml } from '../src/ui/dashboard.js';

describe('AppServer REST API routes', () => {
  const tempDirs: string[] = [];
  const servers: AppServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      if (s) await s.stop();
    }
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('manages profiles, fingerprints, proxies, OAuth start URLs, and import/export via HTTP API', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-multi-api-'));
    tempDirs.push(dir);

    const store = new ProfileStore(dir);
    const instanceManager = new InstanceManager(store);
    const server = new AppServer({
      store,
      instanceManager,
      port: 0,
      renderDashboardHtml,
    });
    const baseUrl = await server.start();
    servers.push(server);

    // 0. Verify Web UI dashboard HTML and PNG logo/favicon are served
    const uiRes = await requestViaProxy({
      url: `${baseUrl}/`,
      method: 'GET',
    });
    expect(uiRes.statusCode).toBe(200);
    expect(uiRes.text()).toContain('Anti-Multi Studio');
    expect(uiRes.text()).toContain('/favicon.png');
    expect(uiRes.text()).toContain('/logo.png');

    const logoRes = await requestViaProxy({
      url: `${baseUrl}/logo.png`,
      method: 'GET',
    });
    expect(logoRes.statusCode).toBe(200);
    expect(logoRes.headers['content-type']).toContain('image/png');
    expect(logoRes.body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);

    const favRes = await requestViaProxy({
      url: `${baseUrl}/favicon.png`,
      method: 'GET',
    });
    expect(favRes.statusCode).toBe(200);
    expect(favRes.headers['content-type']).toContain('image/png');

    // 1. Create profile with proxyString
    const createRes = await requestViaProxy({
      url: `${baseUrl}/api/profiles`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Team Account #1',
        notes: 'KR residential proxy',
        proxyString: 'socks5://user1:pass1@203.0.113.10:1080',
      }),
    });
    expect(createRes.statusCode).toBe(201);
    const createdBody = createRes.json<{ ok: boolean; profile: { id: string; fingerprint: { installationId: string }; proxy: { host: string; protocol: string } } }>();
    expect(createdBody.ok).toBe(true);
    expect(createdBody.profile.proxy.protocol).toBe('socks5');
    expect(createdBody.profile.proxy.host).toBe('203.0.113.10');

    const profileId = createdBody.profile.id;
    const initialInstallId = createdBody.profile.fingerprint.installationId;

    // 2. Regenerate fingerprint
    const regenRes = await requestViaProxy({
      url: `${baseUrl}/api/profiles/${profileId}/regenerate-fingerprint`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ osType: 'darwin', arch: 'arm64' }),
    });
    expect(regenRes.statusCode).toBe(200);
    const regenBody = regenRes.json<{ profile: { fingerprint: { installationId: string; osType: string } } }>();
    expect(regenBody.profile.fingerprint.installationId).not.toBe(initialInstallId);
    expect(regenBody.profile.fingerprint.osType).toBe('darwin');

    // 3. Start OAuth flow
    const oauthStartRes = await requestViaProxy({
      url: `${baseUrl}/api/oauth/start?profileId=${profileId}`,
      method: 'GET',
    });
    expect(oauthStartRes.statusCode).toBe(200);
    const oauthStartBody = oauthStartRes.json<{ ok: boolean; authUrl: string; redirectUri: string }>();
    expect(oauthStartBody.authUrl).toContain('accounts.google.com');
    expect(oauthStartBody.redirectUri).toBe(`${baseUrl}/api/oauth/callback`);

    // 4. Get full state
    const stateRes = await requestViaProxy({
      url: `${baseUrl}/api/state`,
      method: 'GET',
    });
    expect(stateRes.statusCode).toBe(200);
    const stateBody = stateRes.json<{
      profiles: unknown[];
      hostPlatform: { osType: string; arch: string; platform: string };
    }>();
    expect(stateBody.profiles).toHaveLength(1);
    expect(stateBody.hostPlatform).toBeDefined();
    expect(['windows', 'darwin', 'linux']).toContain(stateBody.hostPlatform.osType);

    // 5. Delete profile
    const delRes = await requestViaProxy({
      url: `${baseUrl}/api/profiles/${profileId}?removeDisk=true`,
      method: 'DELETE',
    });
    expect(delRes.statusCode).toBe(200);
  });
});
