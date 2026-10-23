import type { IpCheckResult, ProxyConfig } from '../types.js';
import { formatProxyUrl } from '../utils/fingerprint.js';
import { requestViaProxy } from './proxy-agent.js';

export interface IpCheckerOptions {
  endpoints?: string[];
  timeoutMs?: number;
}

const DEFAULT_IP_CHECK_ENDPOINTS = [
  'https://ipinfo.io/json',
  'https://api.ipify.org?format=json',
];

export async function checkOutboundIp(
  proxy?: ProxyConfig,
  options: IpCheckerOptions = {},
): Promise<IpCheckResult> {
  const endpoints = options.endpoints ?? DEFAULT_IP_CHECK_ENDPOINTS;
  const timeoutMs = options.timeoutMs ?? 10000;
  const viaProxy = Boolean(proxy?.enabled && proxy.host && proxy.port);
  const proxyUrl = proxy && viaProxy ? formatProxyUrl(proxy, false) : undefined;
  const start = Date.now();

  let lastError = 'No IP check endpoint succeeded';

  for (const endpoint of endpoints) {
    try {
      const resp = await requestViaProxy({
        url: endpoint,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'curl/8.7.1',
        },
        proxy: viaProxy ? proxy : undefined,
        timeoutMs,
      });

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        const data = resp.json<Record<string, unknown>>();
        const ip = typeof data.ip === 'string' ? data.ip.trim() : undefined;
        if (ip) {
          return {
            ok: true,
            ip,
            country: typeof data.country === 'string' ? data.country : undefined,
            city: typeof data.city === 'string' ? data.city : undefined,
            org: typeof data.org === 'string' ? data.org : undefined,
            latencyMs: Math.max(1, Date.now() - start),
            viaProxy,
            proxyUrl,
          };
        }
      }
      lastError = `HTTP ${resp.statusCode} from ${endpoint}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    latencyMs: Math.max(1, Date.now() - start),
    viaProxy,
    proxyUrl,
    error: lastError,
  };
}
