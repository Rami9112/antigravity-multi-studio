import crypto from 'node:crypto';
import http from 'node:http';
import { detectLocalHostAntigravityAccount } from '../core/local-importer.js';
import {
  buildGoogleOAuthUrl,
  ensureFreshAccountToken,
  exchangeOAuthCode,
  refreshOAuthToken,
} from '../core/oauth-service.js';
import type { ProfileStore } from '../core/profile-store.js';
import { fetchAccountQuota } from '../core/quota-service.js';
import { checkOutboundIp } from '../gateway/ip-checker.js';
import type { InstanceManager } from '../launcher/instance-manager.js';
import type { AccountProfile, DeviceFingerprint, ProxyConfig } from '../types.js';
import {
  getFaviconPngBuffer,
  getInlineLogoImgHtml,
  getLogoPngBuffer,
} from '../ui/logo.js';
import {
  detectHostArch,
  detectHostOsType,
  parseProxyString,
} from '../utils/fingerprint.js';
import { parseJetskiStoredTokenJson } from '../utils/protobuf.js';

export interface AppServerOptions {
  store: ProfileStore;
  instanceManager: InstanceManager;
  host?: string;
  port?: number;
  renderDashboardHtml?: () => string;
}

interface PendingOAuthSession {
  state: string;
  profileId?: string;
  profileName?: string;
  redirectUri: string;
  createdAt: number;
}

export class AppServer {
  private readonly store: ProfileStore;
  private readonly instanceManager: InstanceManager;
  private readonly host: string;
  private requestedPort: number;
  private boundPort = 0;
  private server: http.Server | null = null;
  private readonly pendingOAuth = new Map<string, PendingOAuthSession>();
  private renderDashboardHtml: () => string;

  constructor(options: AppServerOptions) {
    this.store = options.store;
    this.instanceManager = options.instanceManager;
    this.host = options.host ?? '127.0.0.1';
    this.requestedPort = options.port ?? 4300;
    this.renderDashboardHtml =
      options.renderDashboardHtml ??
      (() => '<!doctype html><html><body><h1>Anti-Multi API Server</h1></body></html>');
  }

  public setDashboardRenderer(renderer: () => string): void {
    this.renderDashboardHtml = renderer;
  }

  public get port(): number {
    return this.boundPort;
  }

  public get url(): string {
    return `http://${this.host}:${this.boundPort}`;
  }

  public async start(): Promise<string> {
    if (this.server) {
      return this.url;
    }

    const srv = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(this.requestedPort, this.host, () => {
        srv.removeListener('error', reject);
        const addr = srv.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to bind AppServer address'));
          return;
        }
        this.boundPort = addr.port;
        this.server = srv;
        resolve();
      });
    });

    return this.url;
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    srv.closeAllConnections();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    try {
      // Serve Brand Logo & Favicon (PNG raster image)
      if (method === 'GET' && pathname === '/logo.png') {
        const buf = getLogoPngBuffer();
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(buf);
        return;
      }

      if (method === 'GET' && (pathname === '/favicon.png' || pathname === '/favicon.ico')) {
        const buf = getFaviconPngBuffer();
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(buf);
        return;
      }

      // Serve Web Dashboard on /
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = this.renderDashboardHtml();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(html);
        return;
      }

      // GET /api/state
      if (method === 'GET' && pathname === '/api/state') {
        sendJson(res, 200, {
          ok: true,
          serverUrl: this.url,
          hostPlatform: {
            osType: detectHostOsType(),
            arch: detectHostArch(),
            platform: process.platform,
          },
          settings: this.store.getSettings(),
          profiles: this.store.listProfiles(),
          runningInstances: this.instanceManager.listRunningInstances(),
        });
        return;
      }

      // PUT /api/settings
      if (method === 'PUT' && pathname === '/api/settings') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const updated = this.store.updateSettings({
          antigravityExecutablePath:
            typeof body.antigravityExecutablePath === 'string'
              ? body.antigravityExecutablePath.trim()
              : undefined,
          defaultTimezone:
            typeof body.defaultTimezone === 'string'
              ? body.defaultTimezone.trim()
              : undefined,
          defaultLocale:
            typeof body.defaultLocale === 'string'
              ? body.defaultLocale.trim()
              : undefined,
          defaultBlockTelemetry:
            typeof body.defaultBlockTelemetry === 'boolean'
              ? body.defaultBlockTelemetry
              : undefined,
        });
        sendJson(res, 200, { ok: true, settings: updated });
        return;
      }

      // POST /api/profiles
      if (method === 'POST' && pathname === '/api/profiles') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const name = typeof body.name === 'string' ? body.name : 'New Profile';
        const notes = typeof body.notes === 'string' ? body.notes : undefined;
        const color = typeof body.color === 'string' ? body.color : undefined;
        const workspacePath =
          typeof body.workspacePath === 'string' ? body.workspacePath : undefined;

        let proxy: Partial<ProxyConfig> | undefined;
        if (typeof body.proxyString === 'string' && body.proxyString.trim()) {
          proxy = parseProxyString(body.proxyString);
        } else if (body.proxy && typeof body.proxy === 'object') {
          proxy = body.proxy as Partial<ProxyConfig>;
        }

        const fingerprint =
          body.fingerprint && typeof body.fingerprint === 'object'
            ? (body.fingerprint as Partial<DeviceFingerprint>)
            : undefined;

        let profile = this.store.createProfile({
          name,
          notes,
          color,
          workspacePath,
          proxy,
          fingerprint,
        });

        // If refreshToken or tokenJson was supplied during profile creation, bind it right away
        if (typeof body.refreshToken === 'string' && body.refreshToken.trim()) {
          profile = await this.bindRefreshTokenToProfile(
            profile.id,
            body.refreshToken.trim(),
          );
        }

        sendJson(res, 201, { ok: true, profile });
        return;
      }

      // POST /api/profiles/import-local
      if (method === 'POST' && pathname === '/api/profiles/import-local') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const preserveHostFingerprint = Boolean(body.preserveHostFingerprint);
        const detected = detectLocalHostAntigravityAccount();
        if (!detected) {
          sendJson(res, 404, {
            ok: false,
            error:
              '현재 PC에서 로그인된 Antigravity 계정(Windows 자격 증명 관리자 / .gemini / state.vscdb)을 찾지 못했습니다.',
          });
          return;
        }

        let account = detected.account;
        if (account.refreshToken) {
          try {
            account = await refreshOAuthToken(account.refreshToken, account);
          } catch {
            // keep detected token if offline
          }
        }

        const profileName =
          typeof body.name === 'string' && body.name.trim()
            ? body.name.trim()
            : account.email && account.email !== 'local@antigravity.user'
              ? `${account.email.split('@')[0]} (${detected.source})`
              : `Local Account (${detected.source})`;

        let profile = this.store.createProfile({
          name: profileName,
          notes: `Imported from ${detected.source}`,
          account,
          fingerprint:
            preserveHostFingerprint && detected.hostInstallationId
              ? { installationId: detected.hostInstallationId }
              : undefined,
        });

        try {
          const quota = await fetchAccountQuota(profile.account!, profile.fingerprint);
          profile = this.store.updateProfile(profile.id, {
            quota,
            account: {
              ...profile.account!,
              projectId: quota.projectId ?? profile.account!.projectId,
              subscriptionTier: quota.tier,
            },
          });
        } catch {
          // non-fatal
        }

        sendJson(res, 201, {
          ok: true,
          source: detected.source,
          profile,
        });
        return;
      }

      //GET /api/oauth/start
      if (method === 'GET' && pathname === '/api/oauth/start') {
        const profileId = parsedUrl.searchParams.get('profileId') || undefined;
        const profileName = parsedUrl.searchParams.get('profileName') || undefined;
        const state = crypto.randomBytes(16).toString('hex');
        const redirectUri = `${this.url}/api/oauth/callback`;

        this.pendingOAuth.set(state, {
          state,
          profileId,
          profileName,
          redirectUri,
          createdAt: Date.now(),
        });

        const authUrl = buildGoogleOAuthUrl(redirectUri, state);
        sendJson(res, 200, {
          ok: true,
          authUrl,
          redirectUri,
          state,
        });
        return;
      }

      // GET /api/oauth/callback
      if (method === 'GET' && pathname === '/api/oauth/callback') {
        const code = parsedUrl.searchParams.get('code');
        const state = parsedUrl.searchParams.get('state') || '';
        const oauthError = parsedUrl.searchParams.get('error');

        if (oauthError || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            renderOAuthCallbackHtml(
              false,
              `Google OAuth 인증 실패: ${oauthError || '인증 코드(code)가 없습니다.'}`,
            ),
          );
          return;
        }

        const pending = this.pendingOAuth.get(state);
        this.pendingOAuth.delete(state);
        const redirectUri = pending?.redirectUri ?? `${this.url}/api/oauth/callback`;

        const targetProfile = pending?.profileId
          ? this.store.getProfile(pending.profileId)
          : undefined;

        const account = await exchangeOAuthCode(code, redirectUri, {
          proxy: targetProfile?.proxy,
        });

        let profile: AccountProfile;
        if (targetProfile) {
          profile = this.store.updateProfile(targetProfile.id, { account });
        } else {
          profile = this.store.createProfile({
            name:
              pending?.profileName ||
              (account.email ? account.email.split('@')[0]! : 'OAuth Account'),
            account,
          });
        }

        try {
          const quota = await fetchAccountQuota(account, profile.fingerprint, {
            proxy: profile.proxy,
          });
          profile = this.store.updateProfile(profile.id, {
            quota,
            account: {
              ...account,
              projectId: quota.projectId ?? account.projectId,
              subscriptionTier: quota.tier,
            },
          });
        } catch {
          // non-fatal
        }

        this.instanceManager.notifyProfileUpdated(profile.id);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          renderOAuthCallbackHtml(
            true,
            `${profile.account?.email ?? profile.name} 계정이 프로필 [${profile.name}]에 연결되었습니다!`,
          ),
        );
        return;
      }

      // POST /api/oauth/exchange-manual
      if (method === 'POST' && pathname === '/api/oauth/exchange-manual') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const rawInput = typeof body.codeOrUrl === 'string' ? body.codeOrUrl.trim() : '';
        const profileId =
          typeof body.profileId === 'string' && body.profileId.trim()
            ? body.profileId.trim()
            : undefined;
        if (!rawInput) {
          sendJson(res, 400, { ok: false, error: '인증 코드 또는 콜백 URL을 입력해주세요.' });
          return;
        }

        let code = rawInput;
        let redirectUri =
          typeof body.redirectUri === 'string' && body.redirectUri.trim()
            ? body.redirectUri.trim()
            : `${this.url}/api/oauth/callback`;

        if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
          const cbUrl = new URL(rawInput);
          const extractedCode = cbUrl.searchParams.get('code');
          if (!extractedCode) {
            sendJson(res, 400, {
              ok: false,
              error: '콜백 URL에서 code 파라미터를 찾을 수 없습니다.',
            });
            return;
          }
          code = extractedCode;
          redirectUri = `${cbUrl.origin}${cbUrl.pathname}`;
        }

        const existingProfile = profileId ? this.store.getProfile(profileId) : undefined;
        const account = await exchangeOAuthCode(code, redirectUri, {
          proxy: existingProfile?.proxy,
        });

        let profile: AccountProfile;
        if (existingProfile) {
          profile = this.store.updateProfile(existingProfile.id, { account });
        } else {
          profile = this.store.createProfile({
            name: account.email ? account.email.split('@')[0]! : 'Manual OAuth Profile',
            account,
          });
        }

        try {
          const quota = await fetchAccountQuota(account, profile.fingerprint, {
            proxy: profile.proxy,
          });
          profile = this.store.updateProfile(profile.id, {
            quota,
            account: {
              ...account,
              projectId: quota.projectId ?? account.projectId,
              subscriptionTier: quota.tier,
            },
          });
        } catch {
          // non-fatal
        }

        this.instanceManager.notifyProfileUpdated(profile.id);

        sendJson(res, 200, { ok: true, profile });
        return;
      }

      // Batch instance endpoints
      if (method === 'POST' && pathname === '/api/instances/launch-batch') {
        const body = await readJsonBody<{ profileIds?: string[]; workspacePath?: string }>(req);
        const profileIds = Array.isArray(body.profileIds) ? body.profileIds : [];
        const launched = [];
        const errors: Array<{ profileId: string; error: string }> = [];

        for (const id of profileIds) {
          try {
            const info = await this.instanceManager.launchProfile(id, {
              workspacePath: body.workspacePath,
            });
            launched.push(info);
          } catch (err) {
            errors.push({
              profileId: id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        sendJson(res, 200, { ok: true, launched, errors });
        return;
      }

      if (method === 'POST' && pathname === '/api/instances/stop-all') {
        await this.instanceManager.stopAll();
        sendJson(res, 200, { ok: true });
        return;
      }

      // Export / Import
      if (method === 'GET' && pathname === '/api/export') {
        sendJson(res, 200, this.store.exportBundle());
        return;
      }

      if (method === 'POST' && pathname === '/api/import') {
        const body = await readJsonBody<
          { profiles?: Array<Partial<AccountProfile>> } | Array<Partial<AccountProfile>>
        >(req);
        const list = Array.isArray(body)
          ? body
          : Array.isArray(body.profiles)
            ? body.profiles
            : [];
        const imported = this.store.importProfiles(list);
        sendJson(res, 201, { ok: true, count: imported.length, profiles: imported });
        return;
      }

      // Profile-scoped routes: /api/profiles/:id[/action]
      const profileMatch = /^\/api\/profiles\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
      if (profileMatch) {
        const profileId = decodeURIComponent(profileMatch[1]!);
        const action = profileMatch[2];

        if (!action && method === 'PUT') {
          const body = await readJsonBody<Record<string, unknown>>(req);
          let proxyPatch: Partial<ProxyConfig> | undefined;
          if (typeof body.proxyString === 'string') {
            proxyPatch = parseProxyString(body.proxyString);
          } else if (body.proxy && typeof body.proxy === 'object') {
            proxyPatch = body.proxy as Partial<ProxyConfig>;
          }

          let updated = this.store.updateProfile(profileId, {
            name: typeof body.name === 'string' ? body.name : undefined,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
            color: typeof body.color === 'string' ? body.color : undefined,
            workspacePath:
              typeof body.workspacePath === 'string' ? body.workspacePath : undefined,
            fingerprint:
              body.fingerprint && typeof body.fingerprint === 'object'
                ? (body.fingerprint as Partial<DeviceFingerprint>)
                : undefined,
            proxy: proxyPatch,
          });

          if (typeof body.refreshToken === 'string' && body.refreshToken.trim()) {
            updated = await this.bindRefreshTokenToProfile(
              profileId,
              body.refreshToken.trim(),
            );
          }

          this.instanceManager.notifyProfileUpdated(profileId);
          sendJson(res, 200, { ok: true, profile: updated });
          return;
        }

        if (!action && method === 'DELETE') {
          await this.instanceManager.stopProfile(profileId);
          const removeDisk = parsedUrl.searchParams.get('removeDisk') === 'true';
          const deleted = this.store.deleteProfile(profileId, removeDisk);
          sendJson(res, deleted ? 200 : 404, { ok: deleted });
          return;
        }

        if (action === 'regenerate-fingerprint' && method === 'POST') {
          const body = await readJsonBody<Partial<DeviceFingerprint>>(req);
          const updated = this.store.regenerateFingerprint(profileId, body);
          this.instanceManager.notifyProfileUpdated(profileId);
          sendJson(res, 200, { ok: true, profile: updated });
          return;
        }

        if (action === 'check-ip' && method === 'POST') {
          const profile = this.store.getProfile(profileId);
          if (!profile) {
            sendJson(res, 404, { ok: false, error: 'Profile not found' });
            return;
          }
          const result = await checkOutboundIp(profile.proxy);
          const updated = this.store.updateProfile(profileId, {
            proxy: {
              ...profile.proxy,
              lastCheckedIp: result.ip ?? profile.proxy.lastCheckedIp,
              lastCheckedCountry: result.country ?? profile.proxy.lastCheckedCountry,
              lastCheckedOrg: result.org ?? profile.proxy.lastCheckedOrg,
              lastCheckedLatencyMs: result.latencyMs,
              lastCheckedAt: new Date().toISOString(),
            },
          });
          sendJson(res, 200, { ok: true, ipCheck: result, profile: updated });
          return;
        }

        if (action === 'bind-refresh-token' && method === 'POST') {
          const body = await readJsonBody<{ refreshToken?: string }>(req);
          const rawToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
          if (!rawToken) {
            sendJson(res, 400, { ok: false, error: 'Refresh token or JSON is required' });
            return;
          }
          const updated = await this.bindRefreshTokenToProfile(profileId, rawToken);
          sendJson(res, 200, { ok: true, profile: updated });
          return;
        }

        if (action === 'refresh-quota' && method === 'POST') {
          let profile = this.store.getProfile(profileId);
          if (!profile || !profile.account) {
            sendJson(res, 400, {
              ok: false,
              error: '이 프로필에 연결된 Google 계정이 없습니다.',
            });
            return;
          }

          const { account: freshAccount } = await ensureFreshAccountToken(
            profile.account,
            { proxy: profile.proxy },
          );
          const quota = await fetchAccountQuota(
            freshAccount,
            profile.fingerprint,
            { proxy: profile.proxy },
          );
          profile = this.store.updateProfile(profileId, {
            quota,
            account: {
              ...freshAccount,
              projectId: quota.projectId ?? freshAccount.projectId,
              subscriptionTier: quota.tier,
            },
          });
          this.instanceManager.notifyProfileUpdated(profileId);
          sendJson(res, 200, { ok: true, profile, quota });
          return;
        }

        if (action === 'launch' && method === 'POST') {
          const body = await readJsonBody<{ workspacePath?: string }>(req);
          const instance = await this.instanceManager.launchProfile(profileId, {
            workspacePath: body.workspacePath,
          });
          sendJson(res, 200, { ok: true, instance });
          return;
        }

        if (action === 'stop' && method === 'POST') {
          const stopped = await this.instanceManager.stopProfile(profileId);
          sendJson(res, 200, { ok: true, stopped });
          return;
        }
      }

      sendJson(res, 404, { ok: false, error: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async bindRefreshTokenToProfile(
    profileId: string,
    rawTokenOrJson: string,
  ): Promise<AccountProfile> {
    const profile = this.store.getProfile(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    let refreshToken = rawTokenOrJson.trim();
    const parsedJson = parseJetskiStoredTokenJson(rawTokenOrJson);
    if (parsedJson?.refreshToken) {
      refreshToken = parsedJson.refreshToken;
    }

    const account = await refreshOAuthToken(refreshToken, parsedJson ?? profile.account, {
      proxy: profile.proxy,
    });

    const autoName =
      (profile.name === 'Token Account' || profile.name === 'New Profile') &&
      account.email &&
      !account.email.endsWith('@google.account') &&
      !account.email.endsWith('@antigravity.user')
        ? account.email.split('@')[0]
        : undefined;

    let updated = this.store.updateProfile(profileId, {
      account,
      name: autoName,
    });
    try {
      const quota = await fetchAccountQuota(account, updated.fingerprint, {
        proxy: updated.proxy,
      });
      updated = this.store.updateProfile(profileId, {
        quota,
        account: {
          ...account,
          projectId: quota.projectId ?? account.projectId,
          subscriptionTier: quota.tier,
        },
      });
    } catch {
      // non-fatal
    }
    this.instanceManager.notifyProfileUpdated(profileId);
    return updated;
  }
}

function escapeHtmlServer(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody<T = Record<string, unknown>>(
  req: http.IncomingMessage,
): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function renderOAuthCallbackHtml(success: boolean, message: string): string {
  const color = success ? '#10b981' : '#ef4444';
  const title = success ? 'OAuth 계정 연결 완료' : 'OAuth 인증 오류';
  const safeMessage = escapeHtmlServer(message);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <title>${title} - Anti-Multi</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #090d16;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 32px 40px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      background: ${color}22;
      color: ${color};
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 16px;
    }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    button {
      background: #6366f1;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="margin-bottom: 14px;">${getInlineLogoImgHtml(52)}</div>
    <div class="badge">${title}</div>
    <h1>${safeMessage}</h1>
    <p>이 창은 자동으로 닫히며 Anti-Multi 웹 대시보드가 즉시 갱신됩니다.</p>
    <button onclick="window.close()">창 닫기</button>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'anti-multi-oauth-complete', success: ${String(success)} }, '*');
    }
    setTimeout(() => { window.close(); }, 1800);
  </script>
</body>
</html>`;
}
