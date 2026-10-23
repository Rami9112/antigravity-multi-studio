import crypto from 'node:crypto';
import {
  OFFICIAL_CHROME_VERSION,
  OFFICIAL_ELECTRON_VERSION,
  OFFICIAL_HUB_CL,
  OFFICIAL_HUB_VERSION,
  OFFICIAL_IDE_VERSION,
} from '../constants.js';
import type {
  DeviceFingerprint,
  ProxyConfig,
  ProxyProtocol,
  SpoofedArchType,
  SpoofedOsType,
} from '../types.js';

export function detectHostOsType(): SpoofedOsType {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

export function detectHostArch(): SpoofedArchType {
  if (process.arch === 'arm64') return 'arm64';
  return 'amd64';
}

export function generateRandomHostname(osType: SpoofedOsType): string {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 7);
  if (osType === 'windows') {
    return `DESKTOP-${suffix}`;
  }
  if (osType === 'darwin') {
    return `MacBook-Pro-${suffix.slice(0, 4)}.local`;
  }
  return `workstation-${suffix.toLowerCase()}`;
}

export function generateDeviceFingerprint(
  overrides: Partial<DeviceFingerprint> = {},
): DeviceFingerprint {
  const osType = overrides.osType ?? detectHostOsType();
  const arch = overrides.arch ?? detectHostArch();
  const devDeviceId = overrides.devDeviceId ?? crypto.randomUUID();
  const hex32 = crypto.randomUUID().replace(/-/g, '').toLowerCase();

  return {
    installationId: overrides.installationId ?? crypto.randomUUID(),
    machineId: overrides.machineId ?? `auth0|user_${hex32}`,
    macMachineId: overrides.macMachineId ?? crypto.randomUUID(),
    devDeviceId,
    sqmId: overrides.sqmId ?? `{${crypto.randomUUID().toUpperCase()}}`,
    serviceMachineId: overrides.serviceMachineId ?? devDeviceId,
    updaterId: overrides.updaterId ?? crypto.randomUUID(),
    osType,
    arch,
    hubVersion: overrides.hubVersion ?? OFFICIAL_HUB_VERSION,
    hubCl: overrides.hubCl ?? OFFICIAL_HUB_CL,
    ideVersion: overrides.ideVersion ?? OFFICIAL_IDE_VERSION,
    hostname: overrides.hostname ?? generateRandomHostname(osType),
    timezone:
      overrides.timezone ??
      (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'),
    locale: overrides.locale ?? 'ko-KR',
    blockTelemetry: overrides.blockTelemetry ?? true,
  };
}

export function buildHubUserAgent(fp: DeviceFingerprint): string {
  return `antigravity/hub/${fp.hubVersion} (aidev_client; os_type=${fp.osType}; arch=${fp.arch}; cl=${fp.hubCl})`;
}

export function buildIdeUserAgent(fp: DeviceFingerprint): string {
  let platformToken = 'Windows NT 10.0; Win64; x64';
  if (fp.osType === 'darwin') {
    platformToken = 'Macintosh; Intel Mac OS X 10_15_7';
  } else if (fp.osType === 'linux') {
    platformToken = 'X11; Linux x86_64';
  } else if (fp.arch === 'arm64') {
    platformToken = 'Windows NT 10.0; ARM64';
  }
  return `Antigravity/${fp.ideVersion} (${platformToken}) Chrome/${OFFICIAL_CHROME_VERSION} Electron/${OFFICIAL_ELECTRON_VERSION}`;
}

export function buildClientMetadataHeader(fp: DeviceFingerprint): string {
  const platformMap: Record<SpoofedOsType, Record<SpoofedArchType, string>> = {
    windows: {
      arm64: 'WINDOWS_ARM64',
      amd64: 'WINDOWS_AMD64',
    },
    darwin: {
      arm64: 'DARWIN_ARM64',
      amd64: 'DARWIN_AMD64',
    },
    linux: {
      arm64: 'LINUX_ARM64',
      amd64: 'LINUX_AMD64',
    },
  };
  const platform = platformMap[fp.osType]?.[fp.arch] ?? 'WINDOWS_AMD64';
  return `ideType=ANTIGRAVITY,ideVersion=${fp.hubVersion},pluginVersion=${fp.hubVersion},platform=${platform},pluginType=CLOUD_CODE,installationId=${fp.installationId}`;
}

/**
 * Rewrites outbound JSON request payloads sent to Cloud Code (`v1internal:*`)
 * so that `metadata` fields (`installationId`, `ideVersion`, `pluginVersion`, `duetProject`, etc.)
 * consistently reflect the profile's isolated device fingerprint rather than the host machine.
 */
export function rewriteCloudCodePayloadMetadata(
  payload: unknown,
  fp: DeviceFingerprint,
  projectId?: string,
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const clone = { ...(payload as Record<string, unknown>) };

  if (projectId && typeof clone.project === 'string' && !clone.project.trim()) {
    clone.project = projectId;
  }

  if (clone.metadata && typeof clone.metadata === 'object' && !Array.isArray(clone.metadata)) {
    const meta = { ...(clone.metadata as Record<string, unknown>) };
    meta.ideType = meta.ideType || 'ANTIGRAVITY';
    meta.installationId = fp.installationId;
    if ('ideVersion' in meta) {
      meta.ideVersion = fp.hubVersion;
    }
    if ('pluginVersion' in meta) {
      meta.pluginVersion = fp.hubVersion;
    }
    if (projectId && !meta.duetProject) {
      meta.duetProject = projectId;
    }
    clone.metadata = meta;
  }

  return clone;
}

export function createDefaultProxyConfig(): ProxyConfig {
  return {
    enabled: false,
    protocol: 'http',
    host: '',
    port: 8080,
  };
}

export function formatProxyUrl(proxy: ProxyConfig, includeAuth = true): string {
  if (!proxy.enabled || !proxy.host || !proxy.port) {
    return '';
  }
  const authPart =
    includeAuth && proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
      : '';
  return `${proxy.protocol}://${authPart}${proxy.host}:${proxy.port}`;
}

/**
 * Parses common proxy string formats:
 * - `socks5://user:pass@1.2.3.4:1080`
 * - `http://1.2.3.4:8080`
 * - `1.2.3.4:8080:user:pass`
 * - `1.2.3.4:8080`
 */
export function parseProxyString(raw: string): ProxyConfig {
  const trimmed = raw.trim();
  if (!trimmed) {
    return createDefaultProxyConfig();
  }

  if (/^(https?|socks5h?):\/\//i.test(trimmed)) {
    const normalized = trimmed.replace(/^socks5h:\/\//i, 'socks5://');
    const url = new URL(normalized);
    const scheme = url.protocol.replace(':', '').toLowerCase();
    const protocol: ProxyProtocol =
      scheme === 'socks5' ? 'socks5' : scheme === 'https' ? 'https' : 'http';
    const port = Number(url.port) || (protocol === 'socks5' ? 1080 : 8080);

    return {
      enabled: true,
      protocol,
      host: url.hostname,
      port,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    };
  }

  const parts = trimmed.split(':');
  if (parts.length >= 2) {
    const host = parts[0]!.trim();
    const port = Number(parts[1]!.trim());
    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid proxy format: ${raw}`);
    }
    const username = parts[2]?.trim() || undefined;
    const password = parts.length > 3 ? parts.slice(3).join(':').trim() : undefined;
    return {
      enabled: true,
      protocol: 'http',
      host,
      port,
      username,
      password,
    };
  }

  throw new Error(`Unsupported proxy format: ${raw}`);
}
