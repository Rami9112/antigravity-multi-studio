import { CLOUD_CODE_FALLBACK_ORIGINS } from '../constants.js';
import { requestViaProxy } from '../gateway/proxy-agent.js';
import type {
  DeviceFingerprint,
  GroupQuotaItem,
  ModelQuotaItem,
  OAuthTokenData,
  ProxyConfig,
  QuotaSummary,
  SubscriptionTier,
} from '../types.js';
import {
  buildHubUserAgent,
} from '../utils/fingerprint.js';

export interface QuotaFetchOptions {
  proxy?: ProxyConfig;
  origins?: string[];
  timeoutMs?: number;
}

interface LoadCodeAssistTier {
  id?: string;
  name?: string;
  isDefault?: boolean;
}

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string | { id?: string };
  currentTier?: LoadCodeAssistTier;
  paidTier?: LoadCodeAssistTier;
  allowedTiers?: LoadCodeAssistTier[];
}

interface RetrieveQuotaSummaryResponse {
  groups?: Array<{
    displayName?: string;
    description?: string;
    buckets?: Array<{
      bucketId?: string;
      window?: string;
      remainingFraction?: number;
      resetTime?: string;
      displayName?: string;
    }>;
  }>;
}

interface FetchAvailableModelsResponse {
  models?: Record<
    string,
    {
      displayName?: string;
      quotaInfo?: {
        remainingFraction?: number;
        resetTime?: string;
      };
    }
  >;
}

export function normalizeTierString(raw?: string): SubscriptionTier {
  if (!raw) return 'FREE';
  const upper = raw.toUpperCase();
  if (upper.includes('ULTRA')) return 'ULTRA';
  if (upper.includes('PRO') || upper.includes('STANDARD') || upper.includes('ENTERPRISE')) {
    return 'PRO';
  }
  if (upper.includes('FREE')) return 'FREE';
  return 'FREE';
}

export async function fetchAccountQuota(
  account: OAuthTokenData,
  fingerprint: DeviceFingerprint,
  options: QuotaFetchOptions = {},
): Promise<QuotaSummary> {
  const origins = options.origins ?? CLOUD_CODE_FALLBACK_ORIGINS;
  const timeoutMs = options.timeoutMs ?? 15000;
  const proxy = options.proxy?.enabled ? options.proxy : undefined;

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${account.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': buildHubUserAgent(fingerprint),
  };

  let projectId = account.projectId;
  let tier: SubscriptionTier = account.subscriptionTier ?? 'FREE';

  // 1. Resolve projectId and subscription tier via loadCodeAssist
  for (const origin of origins) {
    try {
      const resp = await requestViaProxy({
        url: `${origin}/v1internal:loadCodeAssist`,
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({
          metadata: {
            ideType: 'ANTIGRAVITY',
          },
        }),
        proxy,
        timeoutMs,
      });

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        const data = resp.json<LoadCodeAssistResponse>();
        if (typeof data.cloudaicompanionProject === 'string') {
          projectId = data.cloudaicompanionProject;
        } else if (
          data.cloudaicompanionProject &&
          typeof data.cloudaicompanionProject.id === 'string'
        ) {
          projectId = data.cloudaicompanionProject.id;
        }

        const rawTier =
          data.paidTier?.id ||
          data.paidTier?.name ||
          data.currentTier?.id ||
          data.currentTier?.name ||
          data.allowedTiers?.[0]?.id;
        if (rawTier) {
          tier = normalizeTierString(rawTier);
        }
        break;
      }
    } catch {
      // try next origin
    }
  }

  const groups: GroupQuotaItem[] = [];
  const models: ModelQuotaItem[] = [];

  // 2. Fetch grouped quota summary via retrieveUserQuotaSummary
  for (const origin of origins) {
    try {
      const payload: Record<string, unknown> = {};
      if (projectId) payload.project = projectId;
      const resp = await requestViaProxy({
        url: `${origin}/v1internal:retrieveUserQuotaSummary`,
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(payload),
        proxy,
        timeoutMs,
      });

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        const data = resp.json<RetrieveQuotaSummaryResponse>();
        for (const grp of data.groups ?? []) {
          const groupTitle = grp.displayName || 'Model Group';
          for (const b of grp.buckets ?? []) {
            const frac =
              typeof b.remainingFraction === 'number'
                ? Math.max(0, Math.min(1, b.remainingFraction))
                : 1;
            groups.push({
              displayName: b.displayName ? `${groupTitle} (${b.displayName})` : groupTitle,
              remainingPercent: Math.round(frac * 100),
              window: b.window,
              resetTime: b.resetTime,
            });
          }
        }
        break;
      }
    } catch {
      // try next origin
    }
  }

  // 3. Fetch per-model quota via fetchAvailableModels
  for (const origin of origins) {
    try {
      const payload: Record<string, unknown> = {};
      if (projectId) payload.project = projectId;
      const resp = await requestViaProxy({
        url: `${origin}/v1internal:fetchAvailableModels`,
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(payload),
        proxy,
        timeoutMs,
      });

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        const data = resp.json<FetchAvailableModelsResponse>();
        for (const [modelId, info] of Object.entries(data.models ?? {})) {
          const frac =
            typeof info.quotaInfo?.remainingFraction === 'number'
              ? Math.max(0, Math.min(1, info.quotaInfo.remainingFraction))
              : 1;
          models.push({
            modelId,
            displayName: info.displayName || modelId,
            remainingPercent: Math.round(frac * 100),
            resetTime: info.quotaInfo?.resetTime,
          });
        }
        break;
      }
    } catch {
      // try next origin
    }
  }

  return {
    tier,
    projectId,
    models,
    groups,
    updatedAt: new Date().toISOString(),
  };
}
