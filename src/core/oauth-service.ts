import {
  OAUTH_AUTH_URL,
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_SCOPES,
  OAUTH_TOKEN_URL,
  OAUTH_USERINFO_URL,
} from '../constants.js';
import { requestViaProxy } from '../gateway/proxy-agent.js';
import type { OAuthTokenData, ProxyConfig } from '../types.js';
import { decodeJwtClaims } from '../utils/protobuf.js';

export interface OAuthRequestOptions {
  proxy?: ProxyConfig;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfoResponse {
  email?: string;
  name?: string;
  picture?: string;
}

export function isPlaceholderEmail(email?: string): boolean {
  if (!email) return true;
  const trimmed = email.trim().toLowerCase();
  return (
    !trimmed ||
    trimmed === 'unknown@google.account' ||
    trimmed === 'local@antigravity.user' ||
    trimmed === 'authenticated@google.account'
  );
}

export function buildGoogleOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function fetchGoogleUserInfo(
  accessToken: string,
  options: OAuthRequestOptions = {},
): Promise<GoogleUserInfoResponse> {
  const endpoint = options.userInfoEndpoint ?? OAUTH_USERINFO_URL;
  const resp = await requestViaProxy({
    url: endpoint,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    proxy: options.proxy?.enabled ? options.proxy : undefined,
    timeoutMs: 15000,
  });

  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    throw new Error(`Google UserInfo request failed (${resp.statusCode}): ${resp.text()}`);
  }
  return resp.json<GoogleUserInfoResponse>();
}

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
  options: OAuthRequestOptions = {},
): Promise<OAuthTokenData> {
  const tokenEndpoint = options.tokenEndpoint ?? OAUTH_TOKEN_URL;
  const form = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    code: code.trim(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const resp = await requestViaProxy({
    url: tokenEndpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    proxy: options.proxy?.enabled ? options.proxy : undefined,
    timeoutMs: 15000,
  });

  const data = resp.json<GoogleTokenResponse>();
  if (resp.statusCode < 200 || resp.statusCode >= 300 || !data.access_token) {
    throw new Error(
      `OAuth code exchange failed (${resp.statusCode}): ${data.error_description || data.error || resp.text()}`,
    );
  }

  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh_token. Please ensure prompt=consent is preserved.',
    );
  }

  const expiryTimestamp = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3599);

  let email = '';
  let name: string | undefined;
  let picture: string | undefined;

  if (data.id_token) {
    const claims = decodeJwtClaims(data.id_token);
    if (typeof claims?.email === 'string') email = claims.email;
    if (typeof claims?.name === 'string') name = claims.name;
    if (typeof claims?.picture === 'string') picture = claims.picture;
  }

  if (!email) {
    try {
      const info = await fetchGoogleUserInfo(data.access_token, options);
      email = info.email ?? '';
      name = name ?? info.name;
      picture = picture ?? info.picture;
    } catch {
      // ignore if userinfo endpoint unreachable in isolated test
    }
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiryTimestamp,
    tokenType: data.token_type || 'Bearer',
    idToken: data.id_token,
    email: email || 'unknown@google.account',
    name,
    picture,
  };
}

export async function refreshOAuthToken(
  refreshToken: string,
  existing: Partial<OAuthTokenData> = {},
  options: OAuthRequestOptions = {},
): Promise<OAuthTokenData> {
  const tokenEndpoint = options.tokenEndpoint ?? OAUTH_TOKEN_URL;
  const cleanRefresh = refreshToken.trim();
  if (!cleanRefresh) {
    throw new Error('Refresh token cannot be empty');
  }

  const form = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    refresh_token: cleanRefresh,
    grant_type: 'refresh_token',
  });

  const resp = await requestViaProxy({
    url: tokenEndpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    proxy: options.proxy?.enabled ? options.proxy : undefined,
    timeoutMs: 15000,
  });

  const data = resp.json<GoogleTokenResponse>();
  if (resp.statusCode < 200 || resp.statusCode >= 300 || !data.access_token) {
    throw new Error(
      `OAuth token refresh failed (${resp.statusCode}): ${data.error_description || data.error || resp.text()}`,
    );
  }

  const expiryTimestamp = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3599);
  const idToken = data.id_token ?? existing.idToken;

  let email = existing.email ?? '';
  let name = existing.name;
  let picture = existing.picture;

  if (idToken && isPlaceholderEmail(email)) {
    const claims = decodeJwtClaims(idToken);
    if (typeof claims?.email === 'string' && claims.email) email = claims.email;
    if (typeof claims?.name === 'string' && claims.name) name = claims.name;
    if (typeof claims?.picture === 'string' && claims.picture) picture = claims.picture;
  }

  if (isPlaceholderEmail(email)) {
    try {
      const info = await fetchGoogleUserInfo(data.access_token, options);
      if (info.email) email = info.email;
      if (info.name) name = info.name;
      if (info.picture) picture = info.picture;
    } catch {
      // non-fatal
    }
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || cleanRefresh,
    expiryTimestamp,
    tokenType: data.token_type || existing.tokenType || 'Bearer',
    idToken,
    email: email || 'unknown@google.account',
    name,
    picture,
    projectId: existing.projectId,
    subscriptionTier: existing.subscriptionTier,
  };
}

export async function ensureFreshAccountToken(
  account: OAuthTokenData,
  options: OAuthRequestOptions = {},
): Promise<{ account: OAuthTokenData; refreshed: boolean }> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (account.accessToken && account.expiryTimestamp > nowSec + 300) {
    return { account, refreshed: false };
  }
  if (!account.refreshToken) {
    return { account, refreshed: false };
  }
  const updated = await refreshOAuthToken(account.refreshToken, account, options);
  return { account: updated, refreshed: true };
}
