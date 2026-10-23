import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountProfile, OAuthTokenData } from '../types.js';
import {
  decodeUnifiedStateOAuthTokenBase64,
  encodeUnifiedStateOAuthTokenBase64,
  parseJetskiStoredTokenJson,
  toJetskiStoredTokenJson,
} from '../utils/protobuf.js';

const DEFAULT_ANTIGRAVITY_STATE_PBTXT = `post_onboarding: {
  completed_steps: POST_ONBOARDING_STEP_TYPE_MANAGER_WELCOME
  completed_steps: POST_ONBOARDING_STEP_TYPE_USAGE_MODE
  completed_steps: POST_ONBOARDING_STEP_TYPE_AGENT_CONFIGURATION
  completed_steps: POST_ONBOARDING_STEP_TYPE_ADD_WORKSPACE
}
seen_nuxs: {
  uids: 49
  uids: 24
  uids: 54
  uids: 48
}
agent_onboarding_completed: AGENT_ONBOARDING_STATE_COMPLETED
`;

export function seedProfileEnvironment(
  profile: AccountProfile,
  userDataDir: string,
  profileHomeDir: string,
): void {
  const globalStorageDir = path.join(userDataDir, 'User', 'globalStorage');
  const geminiDir = path.join(profileHomeDir, '.gemini');
  const agyHubDir = path.join(geminiDir, 'antigravity');
  const agyIdeDir = path.join(geminiDir, 'antigravity-ide');
  const geminiConfigDir = path.join(geminiDir, 'config');

  fs.mkdirSync(globalStorageDir, { recursive: true });
  fs.mkdirSync(agyHubDir, { recursive: true });
  fs.mkdirSync(agyIdeDir, { recursive: true });
  fs.mkdirSync(geminiConfigDir, { recursive: true });

  // 1. Write <userDataDir>/.updaterId
  fs.writeFileSync(
    path.join(userDataDir, '.updaterId'),
    profile.fingerprint.updaterId,
    'utf8',
  );

  // 2. Write <userDataDir>/app_storage.json (skip IDE install wizard & onboarding modal)
  const appStoragePath = path.join(userDataDir, 'app_storage.json');
  let appStorageObj: Record<string, unknown> = {};
  if (fs.existsSync(appStoragePath)) {
    try {
      appStorageObj = JSON.parse(fs.readFileSync(appStoragePath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      appStorageObj = {};
    }
  }
  appStorageObj.hasCompletedOnboarding = true;
  appStorageObj.hasSeenIdeInstallWizard = true;
  if (!appStorageObj.windowState) {
    appStorageObj.windowState = {
      width: 1400,
      height: 900,
      isMaximized: false,
    };
  }
  fs.writeFileSync(appStoragePath, JSON.stringify(appStorageObj, null, 2), 'utf8');

  // 3. Write <userDataDir>/User/globalStorage/storage.json (spoofed telemetry & machine IDs)
  const storageJsonPath = path.join(globalStorageDir, 'storage.json');
  let storageJsonObj: Record<string, unknown> = {};
  if (fs.existsSync(storageJsonPath)) {
    try {
      storageJsonObj = JSON.parse(fs.readFileSync(storageJsonPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      storageJsonObj = {};
    }
  }
  storageJsonObj['telemetry.machineId'] = profile.fingerprint.machineId;
  storageJsonObj['telemetry.macMachineId'] = profile.fingerprint.macMachineId;
  storageJsonObj['telemetry.devDeviceId'] = profile.fingerprint.devDeviceId;
  storageJsonObj['telemetry.sqmId'] = profile.fingerprint.sqmId;
  storageJsonObj['storage.serviceMachineId'] = profile.fingerprint.serviceMachineId;
  fs.writeFileSync(storageJsonPath, JSON.stringify(storageJsonObj, null, 2), 'utf8');

  // 4. Seed <userDataDir>/User/globalStorage/state.vscdb via built-in node:sqlite
  const vscdbPath = path.join(globalStorageDir, 'state.vscdb');
  const db = new DatabaseSync(vscdbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    const upsert = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
    upsert.run('storage.serviceMachineId', profile.fingerprint.serviceMachineId);
    upsert.run('telemetry.serviceMachineId', profile.fingerprint.serviceMachineId);
    upsert.run('antigravityOnboarding', 'true');

    if (profile.account && (profile.account.accessToken || profile.account.refreshToken)) {
      const encodedProto = encodeUnifiedStateOAuthTokenBase64(profile.account);
      upsert.run('antigravityUnifiedStateSync.oauthToken', encodedProto);
    }
  } finally {
    db.close();
  }

  // 5. Write isolated installation_id files inside <profileHomeDir>/.gemini/
  fs.writeFileSync(
    path.join(agyHubDir, 'installation_id'),
    profile.fingerprint.installationId,
    'utf8',
  );
  fs.writeFileSync(
    path.join(agyIdeDir, 'installation_id'),
    profile.fingerprint.installationId,
    'utf8',
  );

  // 6. Seed antigravity_state.pbtxt so onboarding wizard is skipped
  const statePbtxtPath = path.join(agyHubDir, 'antigravity_state.pbtxt');
  if (!fs.existsSync(statePbtxtPath)) {
    fs.writeFileSync(statePbtxtPath, DEFAULT_ANTIGRAVITY_STATE_PBTXT, 'utf8');
  }

  // 7. Write <profileHomeDir>/.gemini/jetski-standalone-oauth-token for language_server.exe
  const jetskiTokenPath = path.join(geminiDir, 'jetski-standalone-oauth-token');
  if (profile.account && (profile.account.accessToken || profile.account.refreshToken)) {
    const tokenJson = toJetskiStoredTokenJson(profile.account);
    fs.writeFileSync(jetskiTokenPath, JSON.stringify(tokenJson, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  // 8. Copy host .gitconfig if present so Git inside the isolated agent works smoothly
  const hostGitconfig = path.join(os.homedir(), '.gitconfig');
  const profileGitconfig = path.join(profileHomeDir, '.gitconfig');
  if (fs.existsSync(hostGitconfig) && !fs.existsSync(profileGitconfig)) {
    try {
      fs.copyFileSync(hostGitconfig, profileGitconfig);
    } catch {
      // non-fatal
    }
  }
}

/**
 * Checks if the isolated Antigravity instance wrote a new or updated OAuth token
 * to `<profileHomeDir>/.gemini/jetski-standalone-oauth-token` or `state.vscdb`
 * (for example, when the user completes a browser OAuth login inside that instance).
 */
export function syncBackProfileAuthFromDisk(
  profile: AccountProfile,
  userDataDir: string,
  profileHomeDir: string,
): OAuthTokenData | null {
  const jetskiTokenPath = path.join(
    profileHomeDir,
    '.gemini',
    'jetski-standalone-oauth-token',
  );

  if (fs.existsSync(jetskiTokenPath)) {
    try {
      const raw = fs.readFileSync(jetskiTokenPath, 'utf8');
      const parsed = parseJetskiStoredTokenJson(raw);
      if (parsed && (parsed.accessToken || parsed.refreshToken)) {
        const changed =
          !profile.account ||
          (parsed.refreshToken && parsed.refreshToken !== profile.account.refreshToken) ||
          (parsed.accessToken && parsed.accessToken !== profile.account.accessToken);

        if (changed) {
          return {
            accessToken: parsed.accessToken || profile.account?.accessToken || '',
            refreshToken: parsed.refreshToken || profile.account?.refreshToken || '',
            expiryTimestamp:
              parsed.expiryTimestamp || profile.account?.expiryTimestamp || 0,
            tokenType: parsed.tokenType || 'Bearer',
            idToken: parsed.idToken ?? profile.account?.idToken,
            email:
              parsed.email ||
              profile.account?.email ||
              'authenticated@google.account',
            name: parsed.name ?? profile.account?.name,
            picture: parsed.picture ?? profile.account?.picture,
            projectId: parsed.projectId ?? profile.account?.projectId,
            subscriptionTier: profile.account?.subscriptionTier,
          };
        }
      }
    } catch {
      // ignore
    }
  }

  const vscdbPath = path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb');
  if (fs.existsSync(vscdbPath)) {
    try {
      const db = new DatabaseSync(vscdbPath, { open: true, readOnly: true });
      try {
        const row = db
          .prepare('SELECT value FROM ItemTable WHERE key = ?')
          .get('antigravityUnifiedStateSync.oauthToken') as
          | { value?: string | Uint8Array }
          | undefined;
        if (row?.value) {
          const b64 =
            typeof row.value === 'string'
              ? row.value
              : Buffer.from(row.value).toString('utf8');
          const parsed = decodeUnifiedStateOAuthTokenBase64(b64);
          if (parsed && (parsed.accessToken || parsed.refreshToken)) {
            const changed =
              !profile.account ||
              (parsed.refreshToken &&
                parsed.refreshToken !== profile.account.refreshToken) ||
              (parsed.accessToken && parsed.accessToken !== profile.account.accessToken);
            if (changed) {
              return {
                accessToken: parsed.accessToken || profile.account?.accessToken || '',
                refreshToken: parsed.refreshToken || profile.account?.refreshToken || '',
                expiryTimestamp:
                  parsed.expiryTimestamp || profile.account?.expiryTimestamp || 0,
                tokenType: parsed.tokenType || 'Bearer',
                idToken: parsed.idToken ?? profile.account?.idToken,
                email: profile.account?.email || 'authenticated@google.account',
                name: profile.account?.name,
                picture: profile.account?.picture,
                projectId: profile.account?.projectId,
                subscriptionTier: profile.account?.subscriptionTier,
              };
            }
          }
        }
      } finally {
        db.close();
      }
    } catch {
      // ignore
    }
  }

  return null;
}
