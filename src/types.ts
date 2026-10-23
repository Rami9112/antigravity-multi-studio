export type SubscriptionTier = 'FREE' | 'PRO' | 'ULTRA' | 'UNKNOWN';

export interface OAuthTokenData {
  accessToken: string;
  refreshToken: string;
  expiryTimestamp: number;
  tokenType: string;
  idToken?: string;
  email: string;
  name?: string;
  picture?: string;
  projectId?: string;
  subscriptionTier?: SubscriptionTier;
}

export type SpoofedOsType = 'windows' | 'darwin' | 'linux';
export type SpoofedArchType = 'arm64' | 'amd64';

export interface DeviceFingerprint {
  /** 36-char UUID v4 written to <profileHome>/.gemini/antigravity/installation_id */
  installationId: string;
  /** VS Code / Antigravity IDE machineId ("auth0|user_<32_hex>") */
  machineId: string;
  /** UUID v4 for telemetry.macMachineId */
  macMachineId: string;
  /** UUID v4 for telemetry.devDeviceId */
  devDeviceId: string;
  /** Uppercase braced UUID "{UUID}" for telemetry.sqmId */
  sqmId: string;
  /** Matches devDeviceId; stored in storage.serviceMachineId and state.vscdb */
  serviceMachineId: string;
  /** UUID v4 written to <userDataDir>/.updaterId */
  updaterId: string;
  /** Outbound User-Agent / Client-Metadata OS */
  osType: SpoofedOsType;
  /** Outbound User-Agent / Client-Metadata architecture */
  arch: SpoofedArchType;
  /** Antigravity Hub version (e.g. "2.23.1") */
  hubVersion: string;
  /** Antigravity Hub Piper Changelist (e.g. "998881661") */
  hubCl: string;
  /** Antigravity IDE version (e.g. "4.3.0") */
  ideVersion: string;
  /** Spoofed device hostname */
  hostname: string;
  /** Timezone identifier (e.g. "Asia/Seoul") */
  timezone: string;
  /** Locale identifier (e.g. "ko-KR") */
  locale: string;
  /** Whether the local gateway should intercept and drop Clearcut/telemetry requests */
  blockTelemetry: boolean;
}

export type ProxyProtocol = 'http' | 'https' | 'socks5';

export interface ProxyConfig {
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  lastCheckedIp?: string;
  lastCheckedCountry?: string;
  lastCheckedOrg?: string;
  lastCheckedLatencyMs?: number;
  lastCheckedAt?: string;
}

export interface ModelQuotaItem {
  modelId: string;
  displayName: string;
  remainingPercent: number;
  resetTime?: string;
}

export interface GroupQuotaItem {
  displayName: string;
  remainingPercent: number;
  window?: string;
  resetTime?: string;
}

export interface QuotaSummary {
  tier: SubscriptionTier;
  projectId?: string;
  models: ModelQuotaItem[];
  groups: GroupQuotaItem[];
  updatedAt: string;
}

export interface AccountProfile {
  id: string;
  name: string;
  notes?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  lastLaunchedAt?: string;
  workspacePath?: string;
  account?: OAuthTokenData;
  fingerprint: DeviceFingerprint;
  proxy: ProxyConfig;
  quota?: QuotaSummary;
}

export interface RunningInstanceInfo {
  profileId: string;
  profileName: string;
  email?: string;
  pid: number;
  gatewayPort: number;
  gatewayUrl: string;
  userDataDir: string;
  profileHomeDir: string;
  startedAt: string;
  proxySummary: string;
  installationId: string;
  machineId: string;
  spoofedUserAgent: string;
  interceptedRequests: number;
  blockedTelemetryRequests: number;
  lastActivityAt?: string;
}

export interface IpCheckResult {
  ok: boolean;
  ip?: string;
  country?: string;
  city?: string;
  org?: string;
  latencyMs: number;
  viaProxy: boolean;
  proxyUrl?: string;
  error?: string;
}

export interface GlobalSettings {
  antigravityExecutablePath?: string;
  defaultTimezone: string;
  defaultLocale: string;
  defaultBlockTelemetry: boolean;
}

export interface StoreData {
  version: number;
  settings: GlobalSettings;
  profiles: AccountProfile[];
}
