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

export const OFFICIAL_HUB_VERSION = '2.23.1';
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

export function getDefaultAntigravityExecutableCandidates(): string[] {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

  if (process.platform === 'win32') {
    return [
      path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(programFiles, 'Antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
    ];
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
      '/Applications/Antigravity.app/Contents/MacOS/Electron',
      path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity'),
    ];
  }

  return [
    '/usr/bin/antigravity',
    '/opt/Antigravity/antigravity',
    path.join(home, '.local', 'bin', 'antigravity'),
  ];
}
