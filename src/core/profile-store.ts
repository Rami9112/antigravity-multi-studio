import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeConfiguredExecutablePath,
  PROFILE_COLORS,
  resolveAntigravityExecutablePath,
} from '../constants.js';
import type {
  AccountProfile,
  DeviceFingerprint,
  GlobalSettings,
  OAuthTokenData,
  ProxyConfig,
  QuotaSummary,
  StoreData,
} from '../types.js';
import {
  createDefaultProxyConfig,
  generateDeviceFingerprint,
} from '../utils/fingerprint.js';

export interface CreateProfileInput {
  name: string;
  notes?: string;
  color?: string;
  workspacePath?: string;
  account?: OAuthTokenData;
  fingerprint?: Partial<DeviceFingerprint>;
  proxy?: Partial<ProxyConfig>;
}

export interface UpdateProfileInput {
  name?: string;
  notes?: string;
  color?: string;
  workspacePath?: string;
  account?: OAuthTokenData | null;
  fingerprint?: Partial<DeviceFingerprint>;
  proxy?: Partial<ProxyConfig>;
  quota?: QuotaSummary;
  lastLaunchedAt?: string;
}

export class ProfileStore {
  private readonly dataDir: string;
  private readonly storeFilePath: string;
  private data: StoreData;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.storeFilePath = path.join(this.dataDir, 'store.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.getProfilesBaseDir(), { recursive: true });
    this.data = this.loadOrInit();
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  public getProfilesBaseDir(): string {
    return path.join(this.dataDir, 'profiles');
  }

  public getProfileRootDir(profileId: string): string {
    return path.join(this.getProfilesBaseDir(), profileId);
  }

  public getProfileUserDataDir(profileId: string): string {
    return path.join(this.getProfileRootDir(profileId), 'user-data');
  }

  public getProfileHomeDir(profileId: string): string {
    return path.join(this.getProfileRootDir(profileId), 'home');
  }

  private detectDefaultExecutable(): string | undefined {
    return resolveAntigravityExecutablePath();
  }

  private createDefaultStoreData(): StoreData {
    return {
      version: 1,
      settings: {
        antigravityExecutablePath: this.detectDefaultExecutable(),
        defaultTimezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
        defaultLocale: 'ko-KR',
        defaultBlockTelemetry: true,
      },
      profiles: [],
    };
  }

  private loadOrInit(): StoreData {
    if (!fs.existsSync(this.storeFilePath)) {
      const initial = this.createDefaultStoreData();
      this.saveData(initial);
      return initial;
    }

    try {
      const raw = fs.readFileSync(this.storeFilePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      const fallback = this.createDefaultStoreData();
      const configuredExe = parsed.settings?.antigravityExecutablePath;
      const resolvedExe =
        resolveAntigravityExecutablePath(configuredExe) ||
        fallback.settings.antigravityExecutablePath ||
        configuredExe;

      return {
        version: 1,
        settings: {
          ...fallback.settings,
          ...(parsed.settings ?? {}),
          antigravityExecutablePath: resolvedExe,
        },
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      };
    } catch {
      const initial = this.createDefaultStoreData();
      this.saveData(initial);
      return initial;
    }
  }

  private saveData(data: StoreData = this.data): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpPath = `${this.storeFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.storeFilePath);
  }

  public getSettings(): GlobalSettings {
    return { ...this.data.settings };
  }

  public updateSettings(patch: Partial<GlobalSettings>): GlobalSettings {
    const nextPatch = { ...patch };
    if (nextPatch.antigravityExecutablePath) {
      const normalized = normalizeConfiguredExecutablePath(
        nextPatch.antigravityExecutablePath,
      );
      if (normalized) {
        nextPatch.antigravityExecutablePath = normalized;
      }
    }
    this.data.settings = {
      ...this.data.settings,
      ...nextPatch,
    };
    this.saveData();
    return this.getSettings();
  }

  public listProfiles(): AccountProfile[] {
    return this.data.profiles.map((p) => structuredClone(p));
  }

  public getProfile(id: string): AccountProfile | undefined {
    const found = this.data.profiles.find((p) => p.id === id);
    return found ? structuredClone(found) : undefined;
  }

  public createProfile(input: CreateProfileInput): AccountProfile {
    const id = `prof_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const color =
      input.color ||
      PROFILE_COLORS[this.data.profiles.length % PROFILE_COLORS.length]!;

    const fingerprint = generateDeviceFingerprint({
      timezone: this.data.settings.defaultTimezone,
      locale: this.data.settings.defaultLocale,
      blockTelemetry: this.data.settings.defaultBlockTelemetry,
      ...(input.fingerprint ?? {}),
    });

    const proxy: ProxyConfig = {
      ...createDefaultProxyConfig(),
      ...(input.proxy ?? {}),
    };

    const profile: AccountProfile = {
      id,
      name: input.name.trim() || `Profile ${this.data.profiles.length + 1}`,
      notes: input.notes?.trim() || undefined,
      color,
      createdAt: now,
      updatedAt: now,
      workspacePath: input.workspacePath?.trim() || undefined,
      account: input.account ? { ...input.account } : undefined,
      fingerprint,
      proxy,
    };

    this.data.profiles.push(profile);
    this.saveData();
    return structuredClone(profile);
  }

  public updateProfile(id: string, patch: UpdateProfileInput): AccountProfile {
    const idx = this.data.profiles.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`Profile not found: ${id}`);
    }

    const current = this.data.profiles[idx]!;
    let nextProxy = current.proxy;
    if (patch.proxy) {
      const targetChanged =
        (patch.proxy.enabled !== undefined && patch.proxy.enabled !== current.proxy.enabled) ||
        (patch.proxy.host !== undefined && patch.proxy.host !== current.proxy.host) ||
        (patch.proxy.port !== undefined && patch.proxy.port !== current.proxy.port) ||
        (patch.proxy.protocol !== undefined && patch.proxy.protocol !== current.proxy.protocol);

      nextProxy = {
        ...current.proxy,
        ...patch.proxy,
      };
      if (targetChanged && patch.proxy.lastCheckedIp === undefined) {
        delete nextProxy.lastCheckedIp;
        delete nextProxy.lastCheckedCountry;
        delete nextProxy.lastCheckedOrg;
        delete nextProxy.lastCheckedLatencyMs;
        delete nextProxy.lastCheckedAt;
      }
      if (!nextProxy.enabled) {
        delete nextProxy.username;
        delete nextProxy.password;
      }
    }

    const updated: AccountProfile = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      notes: patch.notes !== undefined ? patch.notes.trim() || undefined : current.notes,
      color: patch.color ?? current.color,
      workspacePath:
        patch.workspacePath !== undefined
          ? patch.workspacePath.trim() || undefined
          : current.workspacePath,
      account:
        patch.account === null
          ? undefined
          : patch.account !== undefined
            ? { ...patch.account }
            : current.account,
      fingerprint: patch.fingerprint
        ? { ...current.fingerprint, ...patch.fingerprint }
        : current.fingerprint,
      proxy: nextProxy,
      quota: patch.quota ?? current.quota,
      lastLaunchedAt: patch.lastLaunchedAt ?? current.lastLaunchedAt,
      updatedAt: new Date().toISOString(),
    };

    this.data.profiles[idx] = updated;
    this.saveData();
    return structuredClone(updated);
  }

  public regenerateFingerprint(
    id: string,
    overrides: Partial<DeviceFingerprint> = {},
  ): AccountProfile {
    const current = this.getProfile(id);
    if (!current) {
      throw new Error(`Profile not found: ${id}`);
    }
    const freshFp = generateDeviceFingerprint({
      osType: overrides.osType ?? current.fingerprint.osType,
      arch: overrides.arch ?? current.fingerprint.arch,
      hubVersion: overrides.hubVersion ?? current.fingerprint.hubVersion,
      hubCl: overrides.hubCl ?? current.fingerprint.hubCl,
      ideVersion: overrides.ideVersion ?? current.fingerprint.ideVersion,
      timezone: overrides.timezone ?? current.fingerprint.timezone,
      locale: overrides.locale ?? current.fingerprint.locale,
      blockTelemetry:
        overrides.blockTelemetry ?? current.fingerprint.blockTelemetry,
    });
    return this.updateProfile(id, { fingerprint: freshFp });
  }

  public deleteProfile(id: string, removeDiskFiles = false): boolean {
    const idx = this.data.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.data.profiles.splice(idx, 1);
    this.saveData();

    if (removeDiskFiles) {
      const rootDir = this.getProfileRootDir(id);
      if (fs.existsSync(rootDir)) {
        try {
          fs.rmSync(rootDir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 150,
          });
        } catch {
          // Ignore transient Windows NTFS lock if background handles are still closing
        }
      }
    }
    return true;
  }

  public exportBundle(): StoreData {
    return structuredClone(this.data);
  }

  public importProfiles(
    incomingProfiles: Array<Partial<AccountProfile> & Record<string, unknown>>,
  ): AccountProfile[] {
    const imported: AccountProfile[] = [];
    for (const item of incomingProfiles) {
      if (!item || typeof item !== 'object') continue;

      let account = item.account;
      if (!account) {
        const rawRefresh =
          (typeof item.refresh_token === 'string' && item.refresh_token.trim()) ||
          (typeof item.refreshToken === 'string' && item.refreshToken.trim()) ||
          '';
        const rawAccess =
          (typeof item.access_token === 'string' && item.access_token.trim()) ||
          (typeof item.accessToken === 'string' && item.accessToken.trim()) ||
          '';
        const rawEmail =
          (typeof item.email === 'string' && item.email.trim()) ||
          'unknown@google.account';
        if (rawRefresh || rawAccess) {
          account = {
            accessToken: rawAccess,
            refreshToken: rawRefresh,
            expiryTimestamp: 0,
            tokenType: 'Bearer',
            email: rawEmail,
          };
        }
      }

      let created = this.createProfile({
        name:
          typeof item.name === 'string' && item.name.trim()
            ? item.name
            : account?.email || 'Imported Profile',
        notes: item.notes,
        color: item.color,
        workspacePath: item.workspacePath,
        account,
        fingerprint: item.fingerprint,
        proxy: item.proxy,
      });

      if (item.quota) {
        created = this.updateProfile(created.id, { quota: item.quota });
      }
      imported.push(created);
    }
    return imported;
  }
}
