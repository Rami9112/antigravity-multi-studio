import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  ensureFreshAccountToken,
  fetchGoogleUserInfo,
  isPlaceholderEmail,
} from '../core/oauth-service.js';
import type { ProfileStore } from '../core/profile-store.js';
import { fetchAccountQuota } from '../core/quota-service.js';
import { ProfileStealthGateway } from '../gateway/stealth-gateway.js';
import type { AccountProfile, RunningInstanceInfo } from '../types.js';
import {
  buildHubUserAgent,
  formatProxyUrl,
} from '../utils/fingerprint.js';
import {
  seedProfileEnvironment,
  syncBackProfileAuthFromDisk,
} from './profile-seeder.js';

export interface LaunchInstanceOptions {
  workspacePath?: string;
  executableOverride?: string;
  prependArgs?: string[];
  extraArgs?: string[];
  upstreamOrigin?: string;
}

interface ManagedInstance {
  profileId: string;
  child: ChildProcess;
  pid: number;
  gateway: ProfileStealthGateway;
  userDataDir: string;
  profileHomeDir: string;
  startedAt: string;
  syncInterval: NodeJS.Timeout;
}

export class InstanceManager {
  private readonly store: ProfileStore;
  private readonly instances = new Map<string, ManagedInstance>();

  constructor(store: ProfileStore) {
    this.store = store;
  }

  public isRunning(profileId: string): boolean {
    const inst = this.instances.get(profileId);
    if (!inst) return false;
    if (inst.child.exitCode !== null || inst.child.killed) {
      return false;
    }
    return true;
  }

  public getRunningInfo(profileId: string): RunningInstanceInfo | undefined {
    if (!this.isRunning(profileId)) return undefined;
    const inst = this.instances.get(profileId);
    if (!inst) return undefined;
    const profile = this.store.getProfile(profileId);
    if (!profile) return undefined;
    return this.toRunningInfo(inst, profile);
  }

  public listRunningInstances(): RunningInstanceInfo[] {
    const list: RunningInstanceInfo[] = [];
    for (const [profileId, inst] of this.instances.entries()) {
      if (!this.isRunning(profileId)) {
        continue;
      }
      const profile = this.store.getProfile(profileId);
      if (profile) {
        list.push(this.toRunningInfo(inst, profile));
      }
    }
    return list;
  }

  /**
   * Synchronizes updated profile state (token, fingerprint, proxy) to disk and to
   * the live-running `ProfileStealthGateway` if an instance is active.
   */
  public notifyProfileUpdated(profileId: string): void {
    const profile = this.store.getProfile(profileId);
    if (!profile) return;

    const inst = this.instances.get(profileId);
    if (inst) {
      inst.gateway.updateProfile(profile);
      try {
        seedProfileEnvironment(profile, inst.userDataDir, inst.profileHomeDir);
      } catch {
        // non-fatal
      }
      return;
    }

    const userDataDir = this.store.getProfileUserDataDir(profileId);
    const profileHomeDir = this.store.getProfileHomeDir(profileId);
    if (fs.existsSync(userDataDir) || fs.existsSync(profileHomeDir)) {
      try {
        seedProfileEnvironment(profile, userDataDir, profileHomeDir);
      } catch {
        // non-fatal
      }
    }
  }

  private toRunningInfo(
    inst: ManagedInstance,
    profile: AccountProfile,
  ): RunningInstanceInfo {
    const proxySummary =
      profile.proxy.enabled && profile.proxy.host
        ? `${profile.proxy.protocol}://${profile.proxy.host}:${profile.proxy.port}`
        : 'Direct (Host IP)';

    return {
      profileId: profile.id,
      profileName: profile.name,
      email: profile.account?.email,
      pid: inst.pid,
      gatewayPort: inst.gateway.port,
      gatewayUrl: inst.gateway.url,
      userDataDir: inst.userDataDir,
      profileHomeDir: inst.profileHomeDir,
      startedAt: inst.startedAt,
      proxySummary,
      installationId: profile.fingerprint.installationId,
      machineId: profile.fingerprint.machineId,
      spoofedUserAgent: buildHubUserAgent(profile.fingerprint),
      interceptedRequests: inst.gateway.interceptedRequests,
      blockedTelemetryRequests: inst.gateway.blockedTelemetryRequests,
      lastActivityAt: inst.gateway.lastActivityAt,
    };
  }

  public buildLaunchSpec(
    profile: AccountProfile,
    userDataDir: string,
    profileHomeDir: string,
    gatewayUrl: string,
    workspacePath?: string,
    extraArgs: string[] = [],
    prependArgs: string[] = [],
  ): { args: string[]; env: NodeJS.ProcessEnv } {
    const args: string[] = [...prependArgs, `--user-data-dir=${userDataDir}`];

    if (profile.proxy.enabled && profile.proxy.host && profile.proxy.port) {
      args.push(
        `--proxy-server=${profile.proxy.protocol}://${profile.proxy.host}:${profile.proxy.port}`,
      );
      args.push('--proxy-bypass-list=127.0.0.1;localhost;<local>');
    }

    args.push(...extraArgs);

    const targetWorkspace = workspacePath || profile.workspacePath;
    if (targetWorkspace) {
      args.push(targetWorkspace);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Isolate os.homedir() / os.UserHomeDir() for both Electron and language_server.exe
      USERPROFILE: profileHomeDir,
      HOME: profileHomeDir,
      // Force language_server.exe compositeTokenStorage to use per-profile file storage
      // (<profileHomeDir>/.gemini/jetski-standalone-oauth-token) instead of global Windows Keyring!
      SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 22',
      // Route all language_server.exe Cloud Code requests through our per-profile stealth gateway
      CLOUD_CODE_URL: gatewayUrl,
      // Spoof host identity environment variables
      COMPUTERNAME: profile.fingerprint.hostname,
      HOSTNAME: profile.fingerprint.hostname,
      TZ: profile.fingerprint.timezone,
      LANG: `${profile.fingerprint.locale.replace('-', '_')}.UTF-8`,
      ANTIGRAVITY_PROFILE_ID: profile.id,
      ANTIGRAVITY_PROFILE_NAME: profile.name,
    };

    delete env.ELECTRON_RUN_AS_NODE;

    if (profile.proxy.enabled && profile.proxy.host && profile.proxy.port) {
      const fullProxyUrl = formatProxyUrl(profile.proxy, true);
      env.HTTPS_PROXY = fullProxyUrl;
      env.HTTP_PROXY = fullProxyUrl;
      env.ALL_PROXY = fullProxyUrl;
      env.NO_PROXY = '127.0.0.1,localhost,::1';
    }

    return { args, env };
  }

  public async launchProfile(
    profileId: string,
    options: LaunchInstanceOptions = {},
  ): Promise<RunningInstanceInfo> {
    if (this.isRunning(profileId)) {
      const existing = this.getRunningInfo(profileId);
      if (existing) return existing;
    }

    let profile = this.store.getProfile(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    const exePath =
      options.executableOverride ||
      this.store.getSettings().antigravityExecutablePath;
    if (!exePath || !fs.existsSync(exePath)) {
      throw new Error(
        `Antigravity executable not found at "${exePath ?? ''}". Please configure the executable path in Settings.`,
      );
    }

    // 1. Refresh OAuth token before launch if needed
    if (profile.account && profile.account.refreshToken) {
      try {
        const { account: freshAccount, refreshed } =
          await ensureFreshAccountToken(profile.account, {
            proxy: profile.proxy,
          });
        if (refreshed) {
          profile = this.store.updateProfile(profileId, {
            account: freshAccount,
          });
        }
      } catch {
        // Proceed with existing token if offline/unreachable
      }
    }

    const userDataDir = this.store.getProfileUserDataDir(profileId);
    const profileHomeDir = this.store.getProfileHomeDir(profileId);

    // 2. Seed isolated directories & files (.updaterId, storage.json, state.vscdb, installation_id, jetski-standalone-oauth-token)
    seedProfileEnvironment(profile, userDataDir, profileHomeDir);

    // 3. Start dedicated per-profile Stealth & Proxy Gateway
    const gateway = new ProfileStealthGateway({
      profile,
      upstreamOrigin: options.upstreamOrigin,
      getValidAccessToken: async (id) => {
        this.syncProfileTokenFromDisk(id, userDataDir, profileHomeDir, gateway);
        const latest = this.store.getProfile(id);
        if (!latest?.account) return undefined;
        try {
          const { account: refreshed, refreshed: didRefresh } =
            await ensureFreshAccountToken(latest.account, {
              proxy: latest.proxy,
            });
          if (didRefresh) {
            const updated = this.store.updateProfile(id, { account: refreshed });
            gateway.updateProfile(updated);
            try {
              seedProfileEnvironment(updated, userDataDir, profileHomeDir);
            } catch {
              // non-fatal
            }
          }
          return refreshed.accessToken;
        } catch {
          return latest.account.accessToken;
        }
      },
    });
    await gateway.start(0);

    // 4. Spawn isolated Antigravity process
    const { args, env } = this.buildLaunchSpec(
      profile,
      userDataDir,
      profileHomeDir,
      gateway.url,
      options.workspacePath,
      options.extraArgs,
      options.prependArgs,
    );

    const child = spawn(exePath, args, {
      env,
      stdio: 'ignore',
      detached: false,
      windowsHide: false,
    });

    if (!child.pid) {
      await gateway.stop();
      throw new Error(`Failed to spawn Antigravity process for profile ${profile.name}`);
    }

    const startedAt = new Date().toISOString();
    profile = this.store.updateProfile(profileId, {
      lastLaunchedAt: startedAt,
      workspacePath: options.workspacePath ?? profile.workspacePath,
    });
    gateway.updateProfile(profile);

    const syncInterval = setInterval(() => {
      this.syncProfileTokenFromDisk(profileId, userDataDir, profileHomeDir, gateway);
    }, 4000);
    syncInterval.unref();

    const managed: ManagedInstance = {
      profileId,
      child,
      pid: child.pid,
      gateway,
      userDataDir,
      profileHomeDir,
      startedAt,
      syncInterval,
    };

    this.instances.set(profileId, managed);

    child.once('exit', () => {
      clearInterval(syncInterval);
      this.syncProfileTokenFromDisk(profileId, userDataDir, profileHomeDir, gateway);
      this.instances.delete(profileId);
      void gateway.stop();
    });

    return this.toRunningInfo(managed, profile);
  }

  private syncProfileTokenFromDisk(
    profileId: string,
    userDataDir: string,
    profileHomeDir: string,
    gateway: ProfileStealthGateway,
  ): void {
    const current = this.store.getProfile(profileId);
    if (!current) return;
    const syncedAccount = syncBackProfileAuthFromDisk(
      current,
      userDataDir,
      profileHomeDir,
    );
    if (syncedAccount) {
      const updated = this.store.updateProfile(profileId, {
        account: syncedAccount,
      });
      gateway.updateProfile(updated);

      if (isPlaceholderEmail(syncedAccount.email) && syncedAccount.accessToken) {
        void this.enrichSyncedAccount(profileId, userDataDir, profileHomeDir, gateway);
      }
    }
  }

  private async enrichSyncedAccount(
    profileId: string,
    userDataDir: string,
    profileHomeDir: string,
    gateway: ProfileStealthGateway,
  ): Promise<void> {
    const profile = this.store.getProfile(profileId);
    if (!profile?.account?.accessToken) return;

    try {
      const info = await fetchGoogleUserInfo(profile.account.accessToken, {
        proxy: profile.proxy,
      });
      let nextAccount = {
        ...profile.account,
        email: info.email || profile.account.email,
        name: info.name ?? profile.account.name,
        picture: info.picture ?? profile.account.picture,
      };

      let updated = this.store.updateProfile(profileId, { account: nextAccount });
      try {
        const quota = await fetchAccountQuota(nextAccount, updated.fingerprint, {
          proxy: updated.proxy,
        });
        nextAccount = {
          ...nextAccount,
          projectId: quota.projectId ?? nextAccount.projectId,
          subscriptionTier: quota.tier,
        };
        updated = this.store.updateProfile(profileId, {
          account: nextAccount,
          quota,
        });
      } catch {
        // non-fatal
      }

      gateway.updateProfile(updated);
      try {
        seedProfileEnvironment(updated, userDataDir, profileHomeDir);
      } catch {
        // non-fatal
      }
    } catch {
      // non-fatal
    }
  }

  public async stopProfile(profileId: string): Promise<boolean> {
    const inst = this.instances.get(profileId);
    if (!inst) return false;

    clearInterval(inst.syncInterval);
    this.syncProfileTokenFromDisk(
      profileId,
      inst.userDataDir,
      inst.profileHomeDir,
      inst.gateway,
    );
    this.instances.delete(profileId);

    const exitPromise =
      inst.child.exitCode === null && !inst.child.killed
        ? new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 1500);
            inst.child.once('exit', () => {
              clearTimeout(t);
              resolve();
            });
          })
        : Promise.resolve();

    try {
      if (process.platform === 'win32' && inst.pid) {
        execFileSync('taskkill', ['/PID', String(inst.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        inst.child.kill('SIGTERM');
      }
    } catch {
      try {
        inst.child.kill();
      } catch {
        // ignore if already exited
      }
    }

    await exitPromise;
    await inst.gateway.stop();
    if (process.platform === 'win32') {
      await new Promise((r) => setTimeout(r, 150));
    }
    return true;
  }

  public async stopAll(): Promise<void> {
    const ids = [...this.instances.keys()];
    for (const id of ids) {
      await this.stopProfile(id);
    }
  }
}
