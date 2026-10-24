import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileStore } from '../src/core/profile-store.js';
import { InstanceManager } from '../src/launcher/instance-manager.js';
import {
  seedProfileEnvironment,
  syncBackProfileAuthFromDisk,
} from '../src/launcher/profile-seeder.js';
import { toJetskiStoredTokenJson } from '../src/utils/protobuf.js';

describe('ProfileSeeder & InstanceManager multi-instance isolation', () => {
  const tempDirs: string[] = [];
  const managers: InstanceManager[] = [];

  afterEach(async () => {
    while (managers.length > 0) {
      const m = managers.pop();
      if (m) await m.stopAll();
    }
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('seeds isolated userDataDir and profileHomeDir and syncs back updated tokens', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-multi-seeder-'));
    tempDirs.push(dir);

    const store = new ProfileStore(dir);
    const profile = store.createProfile({
      name: 'Seeder Test',
      account: {
        accessToken: 'ya29.seeded-access',
        refreshToken: '1//0g-seeded-refresh',
        expiryTimestamp: 1850000000,
        tokenType: 'Bearer',
        email: 'seeded@example.com',
        projectId: 'seeded-proj-1',
      },
    });

    const userDataDir = store.getProfileUserDataDir(profile.id);
    const homeDir = store.getProfileHomeDir(profile.id);

    seedProfileEnvironment(profile, userDataDir, homeDir);

    // Verify .updaterId
    expect(fs.readFileSync(path.join(userDataDir, '.updaterId'), 'utf8')).toBe(
      profile.fingerprint.updaterId,
    );

    // Verify storage.json
    const storageJson = JSON.parse(
      fs.readFileSync(
        path.join(userDataDir, 'User', 'globalStorage', 'storage.json'),
        'utf8',
      ),
    ) as Record<string, string>;
    expect(storageJson['telemetry.machineId']).toBe(profile.fingerprint.machineId);
    expect(storageJson['telemetry.devDeviceId']).toBe(profile.fingerprint.devDeviceId);
    expect(storageJson['telemetry.sqmId']).toBe(profile.fingerprint.sqmId);

    // Verify state.vscdb
    const db = new DatabaseSync(
      path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb'),
      { open: true, readOnly: true },
    );
    const row = db
      .prepare('SELECT value FROM ItemTable WHERE key = ?')
      .get('antigravityOnboarding') as { value: string };
    expect(row.value).toBe('true');
    db.close();

    // Verify .gemini/antigravity/installation_id and jetski-standalone-oauth-token
    expect(
      fs.readFileSync(
        path.join(homeDir, '.gemini', 'antigravity', 'installation_id'),
        'utf8',
      ),
    ).toBe(profile.fingerprint.installationId);

    const jetskiTokenPath = path.join(
      homeDir,
      '.gemini',
      'jetski-standalone-oauth-token',
    );
    expect(fs.existsSync(jetskiTokenPath)).toBe(true);

    // Simulate user logging into a new account inside the running Antigravity instance
    const newAccountJson = toJetskiStoredTokenJson({
      accessToken: 'ya29.new-login-token',
      refreshToken: '1//0g-new-login-refresh',
      expiryTimestamp: 1900000000,
      tokenType: 'Bearer',
      email: 'newlogin@example.com',
    });
    fs.writeFileSync(jetskiTokenPath, JSON.stringify(newAccountJson), 'utf8');

    const synced = syncBackProfileAuthFromDisk(profile, userDataDir, homeDir);
    expect(synced?.accessToken).toBe('ya29.new-login-token');
    expect(synced?.refreshToken).toBe('1//0g-new-login-refresh');
    // Should not carry over old account's email/projectId when refreshToken changed
    expect(synced?.email).toBe('authenticated@google.account');
    expect(synced?.projectId).toBeUndefined();

    // Verify stale disk token does NOT clobber newer in-memory token when refreshToken is same
    const fresherProfile = store.updateProfile(profile.id, {
      account: {
        accessToken: 'ya29.fresher-in-memory',
        refreshToken: '1//0g-new-login-refresh',
        expiryTimestamp: 1950000000,
        tokenType: 'Bearer',
        email: 'newlogin@example.com',
      },
    });
    const staleSync = syncBackProfileAuthFromDisk(
      fresherProfile,
      userDataDir,
      homeDir,
    );
    expect(staleSync).toBeNull();
  });

  it('launches multiple concurrent isolated instances with distinct gateways, homes, and proxies', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-multi-launch-'));
    tempDirs.push(dir);

    const store = new ProfileStore(dir);
    const manager = new InstanceManager(store);
    managers.push(manager);

    const p1 = store.createProfile({
      name: 'Instance 1',
      account: {
        accessToken: 'ya29.inst1',
        refreshToken: '1//0g-inst1',
        expiryTimestamp: Math.floor(Date.now() / 1000) + 3600,
        tokenType: 'Bearer',
        email: 'inst1@example.com',
      },
      proxy: {
        enabled: true,
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      },
    });

    const p2 = store.createProfile({
      name: 'Instance 2',
      account: {
        accessToken: 'ya29.inst2',
        refreshToken: '1//0g-inst2',
        expiryTimestamp: Math.floor(Date.now() / 1000) + 3600,
        tokenType: 'Bearer',
        email: 'inst2@example.com',
      },
    });

    // Create a cross-platform dummy executable script or use process.execPath (Node.js)
    const dummyScript = path.join(dir, 'dummy-app.mjs');
    fs.writeFileSync(
      dummyScript,
      `import fs from 'node:fs';
import path from 'node:path';
const home = process.env.USERPROFILE || process.env.HOME;
fs.writeFileSync(path.join(home, 'spawn-env.json'), JSON.stringify({
  args: process.argv.slice(2),
  USERPROFILE: process.env.USERPROFILE,
  SSH_CONNECTION: process.env.SSH_CONNECTION,
  CLOUD_CODE_URL: process.env.CLOUD_CODE_URL,
  COMPUTERNAME: process.env.COMPUTERNAME,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
}));
setInterval(() => {}, 1000);
`,
      'utf8',
    );

    const [run1, run2] = await Promise.all([
      manager.launchProfile(p1.id, {
        executableOverride: process.execPath,
        prependArgs: [dummyScript],
      }),
      manager.launchProfile(p2.id, {
        executableOverride: process.execPath,
        prependArgs: [dummyScript],
      }),
    ]);

    expect(run1.pid).not.toBe(run2.pid);
    expect(run1.gatewayPort).not.toBe(run2.gatewayPort);
    expect(run1.installationId).not.toBe(run2.installationId);
    expect(manager.listRunningInstances()).toHaveLength(2);

    // Wait briefly for dummy script to write spawn-env.json
    await new Promise((r) => setTimeout(r, 400));

    const env1 = JSON.parse(
      fs.readFileSync(path.join(run1.profileHomeDir, 'spawn-env.json'), 'utf8'),
    ) as Record<string, unknown>;
    const env2 = JSON.parse(
      fs.readFileSync(path.join(run2.profileHomeDir, 'spawn-env.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(env1.USERPROFILE).toBe(run1.profileHomeDir);
    expect(env2.USERPROFILE).toBe(run2.profileHomeDir);
    expect(env1.SSH_CONNECTION).toBe('127.0.0.1 0 127.0.0.1 22');
    expect(env1.CLOUD_CODE_URL).toBe(run1.gatewayUrl);
    expect(env2.CLOUD_CODE_URL).toBe(run2.gatewayUrl);
    expect(env1.COMPUTERNAME).toBe(p1.fingerprint.hostname);
    expect(env2.COMPUTERNAME).toBe(p2.fingerprint.hostname);
    expect(env1.HTTPS_PROXY).toBe('socks5://127.0.0.1:1080');

    await manager.stopAll();
    expect(manager.listRunningInstances()).toHaveLength(0);
  });
});
