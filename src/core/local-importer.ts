import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OAuthTokenData } from '../types.js';
import {
  decodeUnifiedStateOAuthTokenBase64,
  parseJetskiStoredTokenJson,
} from '../utils/protobuf.js';

export interface LocalImportDetection {
  source: 'windows-credential-manager' | 'jetski-file-store' | 'state-vscdb';
  account: OAuthTokenData;
  hostInstallationId?: string;
}

const WIN_CRED_READ_PS1 = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class AntiMultiCredReader {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);

    public static string ReadUtf8(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return "";
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) return "";
            byte[] bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, (int)cred.CredentialBlobSize);
            return Encoding.UTF8.GetString(bytes);
        } finally {
            CredFree(ptr);
        }
    }
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$blob = [AntiMultiCredReader]::ReadUtf8("gemini:antigravity")
if ($blob) {
    Write-Output $blob
}
`;

export function readWindowsKeyringStoredTokenJson(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-multi-cred-'));
  const scriptPath = path.join(tempDir, 'read-cred.ps1');
  try {
    fs.writeFileSync(scriptPath, WIN_CRED_READ_PS1, 'utf8');
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
      },
    ).trim();
    return output || null;
  } catch {
    return null;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function readHostInstallationId(homeDir = os.homedir()): string | undefined {
  const candidates = [
    path.join(homeDir, '.gemini', 'antigravity', 'installation_id'),
    path.join(homeDir, '.gemini', 'antigravity-ide', 'installation_id'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const val = fs.readFileSync(file, 'utf8').trim();
        if (val.length >= 16) return val;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function readAccountFromStateVscdb(vscdbPath: string): Partial<OAuthTokenData> | null {
  if (!fs.existsSync(vscdbPath)) {
    return null;
  }
  try {
    const db = new DatabaseSync(vscdbPath, { open: true, readOnly: true });
    try {
      const stmt = db.prepare(
        'SELECT value FROM ItemTable WHERE key = ?',
      );
      const row = stmt.get('antigravityUnifiedStateSync.oauthToken') as
        | { value?: string | Uint8Array }
        | undefined;
      if (!row || !row.value) return null;
      const b64 =
        typeof row.value === 'string'
          ? row.value
          : Buffer.from(row.value).toString('utf8');
      return decodeUnifiedStateOAuthTokenBase64(b64);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function detectLocalHostAntigravityAccount(
  options: {
    homeDir?: string;
    appDataDir?: string;
    keyringJsonOverride?: string | null;
  } = {},
): LocalImportDetection | null {
  const homeDir = options.homeDir ?? os.homedir();
  const appDataDir =
    options.appDataDir ??
    process.env.APPDATA ??
    path.join(homeDir, 'AppData', 'Roaming');

  const hostInstallationId = readHostInstallationId(homeDir);

  // 1. Check file-based token in <homeDir>/.gemini/jetski-standalone-oauth-token
  const jetskiTokenFile = path.join(homeDir, '.gemini', 'jetski-standalone-oauth-token');
  if (fs.existsSync(jetskiTokenFile)) {
    try {
      const raw = fs.readFileSync(jetskiTokenFile, 'utf8');
      const parsed = parseJetskiStoredTokenJson(raw);
      if (parsed && (parsed.refreshToken || parsed.accessToken)) {
        return {
          source: 'jetski-file-store',
          hostInstallationId,
          account: {
            accessToken: parsed.accessToken || '',
            refreshToken: parsed.refreshToken || '',
            expiryTimestamp: parsed.expiryTimestamp || 0,
            tokenType: parsed.tokenType || 'Bearer',
            idToken: parsed.idToken,
            email: parsed.email || 'local@antigravity.user',
            name: parsed.name,
            picture: parsed.picture,
            projectId: parsed.projectId,
          },
        };
      }
    } catch {
      // fall through
    }
  }

  // 2. Check Windows Credential Manager (`gemini:antigravity`)
  const keyringRaw =
    options.keyringJsonOverride !== undefined
      ? options.keyringJsonOverride
      : readWindowsKeyringStoredTokenJson();
  if (keyringRaw) {
    const parsed = parseJetskiStoredTokenJson(keyringRaw);
    if (parsed && (parsed.refreshToken || parsed.accessToken)) {
      return {
        source: 'windows-credential-manager',
        hostInstallationId,
        account: {
          accessToken: parsed.accessToken || '',
          refreshToken: parsed.refreshToken || '',
          expiryTimestamp: parsed.expiryTimestamp || 0,
          tokenType: parsed.tokenType || 'Bearer',
          idToken: parsed.idToken,
          email: parsed.email || 'local@antigravity.user',
          name: parsed.name,
          picture: parsed.picture,
          projectId: parsed.projectId,
        },
      };
    }
  }

  // 3. Check state.vscdb in %APPDATA%/Antigravity/User/globalStorage/state.vscdb
  const vscdbCandidates = [
    path.join(appDataDir, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    path.join(
      homeDir,
      'Library',
      'Application Support',
      'Antigravity',
      'User',
      'globalStorage',
      'state.vscdb',
    ),
    path.join(homeDir, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
  ];

  for (const vscdbPath of vscdbCandidates) {
    const parsed = readAccountFromStateVscdb(vscdbPath);
    if (parsed && (parsed.refreshToken || parsed.accessToken)) {
      return {
        source: 'state-vscdb',
        hostInstallationId,
        account: {
          accessToken: parsed.accessToken || '',
          refreshToken: parsed.refreshToken || '',
          expiryTimestamp: parsed.expiryTimestamp || 0,
          tokenType: parsed.tokenType || 'Bearer',
          idToken: parsed.idToken,
          email: parsed.email || 'local@antigravity.user',
        },
      };
    }
  }

  return null;
}
