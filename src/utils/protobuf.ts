import type { OAuthTokenData } from '../types.js';

export function encodeVarint(value: bigint | number): Buffer {
  let n = typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.floor(value)));
  const bytes: number[] = [];
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

export function decodeVarint(buf: Buffer, offset: number): { value: bigint; nextOffset: number } {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos]!;
    result |= BigInt(byte & 0x7f) << shift;
    pos += 1;
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: pos };
    }
    shift += 7n;
  }
  throw new Error('Malformed varint in protobuf buffer');
}

export function encodeLengthDelimitedField(fieldNumber: number, payload: Buffer | string): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const length = encodeVarint(data.length);
  return Buffer.concat([tag, length, data]);
}

export function encodeVarintField(fieldNumber: number, value: bigint | number): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | 0);
  const encodedVal = encodeVarint(value);
  return Buffer.concat([tag, encodedVal]);
}

export interface ProtoField {
  fieldNumber: number;
  wireType: number;
  data: Buffer;
  varintValue?: bigint;
}

export function parseProtoFields(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;

  while (offset < buf.length) {
    const tagInfo = decodeVarint(buf, offset);
    offset = tagInfo.nextOffset;
    const fieldNumber = Number(tagInfo.value >> 3n);
    const wireType = Number(tagInfo.value & 7n);

    if (wireType === 0) {
      const valInfo = decodeVarint(buf, offset);
      offset = valInfo.nextOffset;
      fields.push({
        fieldNumber,
        wireType,
        data: Buffer.alloc(0),
        varintValue: valInfo.value,
      });
    } else if (wireType === 2) {
      const lenInfo = decodeVarint(buf, offset);
      offset = lenInfo.nextOffset;
      const len = Number(lenInfo.value);
      const slice = buf.subarray(offset, offset + len);
      offset += len;
      fields.push({
        fieldNumber,
        wireType,
        data: slice,
      });
    } else if (wireType === 1) {
      const slice = buf.subarray(offset, offset + 8);
      offset += 8;
      fields.push({ fieldNumber, wireType, data: slice });
    } else if (wireType === 5) {
      const slice = buf.subarray(offset, offset + 4);
      offset += 4;
      fields.push({ fieldNumber, wireType, data: slice });
    } else {
      throw new Error(`Unsupported protobuf wireType: ${wireType}`);
    }
  }

  return fields;
}

/**
 * Encodes OAuthTokenInfo wrapped inside a UnifiedStateSync Topic entry
 * (`oauthTokenInfoSentinelKey`) as base64 for `state.vscdb`
 * (`antigravityUnifiedStateSync.oauthToken`).
 */
export function encodeUnifiedStateOAuthTokenBase64(token: OAuthTokenData): string {
  const timestampMsg = encodeVarintField(1, BigInt(Math.max(0, Math.floor(token.expiryTimestamp))));

  const tokenInfoParts: Buffer[] = [
    encodeLengthDelimitedField(1, token.accessToken),
    encodeLengthDelimitedField(2, token.tokenType || 'Bearer'),
    encodeLengthDelimitedField(3, token.refreshToken),
    encodeLengthDelimitedField(4, timestampMsg),
  ];

  if (token.idToken) {
    tokenInfoParts.push(encodeLengthDelimitedField(5, token.idToken));
  }
  tokenInfoParts.push(encodeVarintField(6, 1));

  const oauthTokenInfoBytes = Buffer.concat(tokenInfoParts);
  const innerValueBase64 = oauthTokenInfoBytes.toString('base64');

  const innerWrapper = encodeLengthDelimitedField(1, innerValueBase64);
  const mapEntry = Buffer.concat([
    encodeLengthDelimitedField(1, 'oauthTokenInfoSentinelKey'),
    encodeLengthDelimitedField(2, innerWrapper),
  ]);
  const topic = encodeLengthDelimitedField(1, mapEntry);
  return topic.toString('base64');
}

/**
 * Decodes `antigravityUnifiedStateSync.oauthToken` base64 string from `state.vscdb`.
 */
export function decodeUnifiedStateOAuthTokenBase64(
  topicBase64: string,
): Partial<OAuthTokenData> | null {
  try {
    const topicBuf = Buffer.from(topicBase64.trim(), 'base64');
    const topicFields = parseProtoFields(topicBuf);

    for (const tf of topicFields) {
      if (tf.fieldNumber !== 1 || tf.wireType !== 2) continue;
      const entryFields = parseProtoFields(tf.data);
      const keyField = entryFields.find((f) => f.fieldNumber === 1 && f.wireType === 2);
      const valField = entryFields.find((f) => f.fieldNumber === 2 && f.wireType === 2);
      if (!keyField || !valField) continue;

      if (keyField.data.toString('utf8') !== 'oauthTokenInfoSentinelKey') continue;

      const wrapperFields = parseProtoFields(valField.data);
      const b64Field = wrapperFields.find((f) => f.fieldNumber === 1 && f.wireType === 2);
      if (!b64Field) continue;

      const tokenInfoBuf = Buffer.from(b64Field.data.toString('utf8'), 'base64');
      const infoFields = parseProtoFields(tokenInfoBuf);

      const accessToken = infoFields
        .find((f) => f.fieldNumber === 1 && f.wireType === 2)
        ?.data.toString('utf8');
      const tokenType =
        infoFields.find((f) => f.fieldNumber === 2 && f.wireType === 2)?.data.toString('utf8') ||
        'Bearer';
      const refreshToken = infoFields
        .find((f) => f.fieldNumber === 3 && f.wireType === 2)
        ?.data.toString('utf8');
      const tsField = infoFields.find((f) => f.fieldNumber === 4 && f.wireType === 2);
      let expiryTimestamp = 0;
      if (tsField) {
        const tsParts = parseProtoFields(tsField.data);
        const sec = tsParts.find((f) => f.fieldNumber === 1 && f.wireType === 0)?.varintValue;
        if (sec !== undefined) {
          expiryTimestamp = Number(sec);
        }
      }
      const idToken = infoFields
        .find((f) => f.fieldNumber === 5 && f.wireType === 2)
        ?.data.toString('utf8');

      if (accessToken || refreshToken) {
        return {
          accessToken: accessToken || '',
          refreshToken: refreshToken || '',
          tokenType,
          expiryTimestamp,
          idToken,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Formats an OAuthTokenData object into the exact JSON structure expected by
 * Antigravity v2.x `language_server.exe` (`jetski-standalone-oauth-token` & `gemini:antigravity`).
 */
export interface JetskiStoredTokenJson {
  token: {
    access_token: string;
    token_type: string;
    refresh_token: string;
    expiry: string;
  };
  auth_method: string;
  id_token?: string;
  project_id?: string;
  user_tier?: string;
}

export function toJetskiStoredTokenJson(account: OAuthTokenData): JetskiStoredTokenJson {
  const expiryMs =
    account.expiryTimestamp > 0
      ? account.expiryTimestamp * 1000
      : Date.now() + 3600 * 1000;

  const result: JetskiStoredTokenJson = {
    token: {
      access_token: account.accessToken,
      token_type: account.tokenType || 'Bearer',
      refresh_token: account.refreshToken,
      expiry: new Date(expiryMs).toISOString(),
    },
    auth_method: 'standard',
  };

  if (account.idToken) {
    result.id_token = account.idToken;
  }
  if (account.projectId) {
    result.project_id = account.projectId;
  }
  return result;
}

export function parseJetskiStoredTokenJson(rawJson: string): Partial<OAuthTokenData> | null {
  try {
    const parsed = JSON.parse(rawJson) as Partial<JetskiStoredTokenJson>;
    if (!parsed || typeof parsed !== 'object' || !parsed.token) {
      return null;
    }
    const { access_token, refresh_token, token_type, expiry } = parsed.token;
    if (!access_token && !refresh_token) {
      return null;
    }
    const expiryMs = expiry ? Date.parse(expiry) : Number.NaN;
    const expiryTimestamp = Number.isFinite(expiryMs) ? Math.floor(expiryMs / 1000) : 0;

    let email = '';
    let name: string | undefined;
    let picture: string | undefined;

    if (parsed.id_token) {
      const claims = decodeJwtClaims(parsed.id_token);
      if (typeof claims?.email === 'string') email = claims.email;
      if (typeof claims?.name === 'string') name = claims.name;
      if (typeof claims?.picture === 'string') picture = claims.picture;
    }

    return {
      accessToken: access_token || '',
      refreshToken: refresh_token || '',
      tokenType: token_type || 'Bearer',
      expiryTimestamp,
      idToken: parsed.id_token,
      projectId: parsed.project_id,
      email,
      name,
      picture,
    };
  } catch {
    return null;
  }
}

export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}
