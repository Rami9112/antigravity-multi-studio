import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OAUTH_CLIENT_ID =
  ['1071006060591', '-tmhssin2h21lcre235vtolojh4g403ep', '.apps.google', 'usercontent.com'].join('');
export const OAUTH_CLIENT_SECRET = ['GOC', 'SPX-', 'K58FWR486LdLJ', '1mLB8sXC4z6qDAf'].join('');

export const OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

export const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export const CLOUD_CODE_PRIMARY_ORIGIN = 'https://daily-cloudcode-pa.googleapis.com';
export const CLOUD_CODE_FALLBACK_ORIGINS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

export const OFFICIAL_HUB_VERSION = '2.27.0';
export const OFFICIAL_HUB_CL = '998881661';
export const OFFICIAL_IDE_VERSION = '4.3.0';
export const OFFICIAL_ELECTRON_VERSION = '39.2.3';
export const OFFICIAL_CHROME_VERSION = '132.0.6834.160';

export const DEFAULT_SERVER_PORT = 4300;
export const DEFAULT_SERVER_HOST = '127.0.0.1';

export const PROFILE_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
];

export function getDefaultAntigravityExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const candidates: string[] = [];

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programW6432 = env.ProgramW6432;

    const winFolders = ['antigravity', 'Antigravity', 'Antigravity IDE', 'antigravity-ide'];
    const winExes = ['Antigravity.exe', 'antigravity.exe', 'Antigravity IDE.exe', 'antigravity-ide.exe'];

    for (const folder of winFolders) {
      for (const exe of winExes) {
        candidates.push(path.win32.join(localAppData, 'Programs', folder, exe));
        candidates.push(path.win32.join(localAppData, folder, exe));
        candidates.push(path.win32.join(programFiles, folder, exe));
        candidates.push(path.win32.join(programFilesX86, folder, exe));
        if (programW6432) {
          candidates.push(path.win32.join(programW6432, folder, exe));
        }
      }
    }

    if (env.PATH) {
      for (const dir of env.PATH.split(';')) {
        const trimmed = dir.trim();
        if (!trimmed) continue;
        candidates.push(path.win32.join(trimmed, 'Antigravity.exe'));
        candidates.push(path.win32.join(trimmed, 'antigravity.exe'));
      }
    }
    return [...new Set(candidates)];
  }

  if (platform === 'darwin') {
    const appNames = ['Antigravity.app', 'Antigravity IDE.app'];
    const binaryNames = ['Antigravity', 'Electron', 'Antigravity IDE', 'antigravity'];
    const appRoots = ['/Applications', path.posix.join(home, 'Applications')];

    for (const root of appRoots) {
      for (const appName of appNames) {
        for (const bin of binaryNames) {
          candidates.push(path.posix.join(root, appName, 'Contents', 'MacOS', bin));
        }
        candidates.push(path.posix.join(root, appName));
      }
    }

    if (env.PATH) {
      for (const dir of env.PATH.split(':')) {
        const trimmed = dir.trim();
        if (!trimmed) continue;
        candidates.push(path.posix.join(trimmed, 'antigravity'));
        candidates.push(path.posix.join(trimmed, 'Antigravity'));
      }
    }
    return [...new Set(candidates)];
  }

  // Linux & other POSIX platforms
  const linuxStatic = [
    '/usr/bin/antigravity',
    '/usr/local/bin/antigravity',
    '/opt/Antigravity/antigravity',
    '/opt/antigravity/antigravity',
    '/opt/Antigravity/Antigravity',
    '/usr/share/antigravity/antigravity',
    '/usr/share/Antigravity/antigravity',
    '/usr/lib/antigravity/antigravity',
    '/usr/lib64/antigravity/antigravity',
    '/snap/bin/antigravity',
    '/var/lib/flatpak/exports/bin/antigravity',
    path.posix.join(home, '.local', 'bin', 'antigravity'),
    path.posix.join(home, '.local', 'share', 'flatpak', 'exports', 'bin', 'antigravity'),
    path.posix.join(home, 'Applications', 'Antigravity.AppImage'),
    path.posix.join(home, 'Applications', 'antigravity.AppImage'),
  ];
  candidates.push(...linuxStatic);

  if (env.PATH) {
    for (const dir of env.PATH.split(':')) {
      const trimmed = dir.trim();
      if (!trimmed) continue;
      candidates.push(path.posix.join(trimmed, 'antigravity'));
      candidates.push(path.posix.join(trimmed, 'Antigravity'));
    }
  }

  return [...new Set(candidates)];
}

/**
 * Resolves a single user-specified path if it exists on disk (including `.app` bundles on macOS
 * or parent installation directories on Windows/Linux). Returns `undefined` if not found on disk.
 */
export function normalizeConfiguredExecutablePath(
  targetPath?: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!targetPath) return undefined;
  const trimmed = targetPath.trim();
  if (!trimmed) return undefined;

  // If user pointed inside a macOS .app bundle or to the .app directory itself
  const appMatch = /^(.+?\.app)(?:\/.*)?$/i.exec(trimmed);
  if (appMatch && (platform === 'darwin' || trimmed.toLowerCase().endsWith('.app'))) {
    const bundleRoot = appMatch[1]!;
    const macosDir = path.join(bundleRoot, 'Contents', 'MacOS');
    const preferredBins = ['Antigravity', 'Electron', 'Antigravity IDE', 'antigravity'];
    for (const bin of preferredBins) {
      const binPath = path.join(macosDir, bin);
      if (fs.existsSync(binPath) && isFileSafe(binPath)) {
        return binPath;
      }
    }
    if (fs.existsSync(macosDir)) {
      try {
        const entries = fs.readdirSync(macosDir);
        for (const entry of entries) {
          const full = path.join(macosDir, entry);
          if (isFileSafe(full)) {
            return full;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (!fs.existsSync(trimmed)) {
    return undefined;
  }

  if (isFileSafe(trimmed)) {
    return trimmed;
  }

  // If targetPath is a directory on Windows/Linux, look for the executable inside it
  try {
    const stat = fs.statSync(trimmed);
    if (stat.isDirectory()) {
      const subCandidates =
        platform === 'win32'
          ? ['Antigravity.exe', 'antigravity.exe', 'Antigravity IDE.exe']
          : ['Antigravity', 'antigravity', 'Electron'];
      for (const sub of subCandidates) {
        const full = path.join(trimmed, sub);
        if (isFileSafe(full)) {
          return full;
        }
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

/**
 * Resolves a user-provided or auto-detected Antigravity path to an actual runnable executable binary.
 * Handles:
 * - macOS `.app` bundle directories (`/Applications/Antigravity.app` -> `.../Contents/MacOS/Antigravity`)
 * - Windows/Linux installation directories (`C:\...\Programs\antigravity` -> `...\Antigravity.exe`)
 * - Cross-platform fallback when `store.json` is migrated between Windows, macOS, and Linux
 */
export function resolveAntigravityExecutablePath(
  configuredPath?: string,
  platform: NodeJS.Platform = process.platform,
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (configuredPath) {
    const resolved = normalizeConfiguredExecutablePath(configuredPath, platform);
    if (resolved) {
      return resolved;
    }
  }

  for (const candidate of getDefaultAntigravityExecutableCandidates(platform, home, env)) {
    const resolved = normalizeConfiguredExecutablePath(candidate, platform);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function isFileSafe(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
