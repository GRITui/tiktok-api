import { createHmac, timingSafeEqual } from "node:crypto";

/** Query params that are never part of the signature base string. */
const EXCLUDED_KEYS = new Set(["sign", "access_token"]);

export interface SignInput {
  appSecret: string;
  /** Request path without host, e.g. `/order/202309/orders/search`. */
  path: string;
  query: Record<string, string | number | undefined>;
  /** Raw JSON body as sent on the wire. Omit for GET and multipart requests. */
  body?: string;
  contentType?: string;
}

/**
 * TikTok Shop Open API request signature (API v2 / 202309+).
 *
 * 1. Drop `sign` and `access_token`, sort remaining query keys ascending.
 * 2. Concatenate `{key}{value}` pairs and prefix with the request path.
 * 3. Append the raw body unless the request is multipart/form-data.
 * 4. Wrap with the app secret on both ends.
 * 5. HMAC-SHA256 keyed with the app secret, hex encoded.
 *
 * VERIFY against Partner Center "Sign your API request" before production use.
 */
export function signRequest({ appSecret, path, query, body, contentType }: SignInput): string {
  const params = Object.keys(query)
    .filter((k) => !EXCLUDED_KEYS.has(k) && query[k] !== undefined)
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");

  let base = `${path}${params}`;
  if (body && !contentType?.toLowerCase().startsWith("multipart/form-data")) {
    base += body;
  }
  return createHmac("sha256", appSecret).update(`${appSecret}${base}${appSecret}`).digest("hex");
}

/**
 * Verify a webhook push. TikTok sends `Authorization: HMAC-SHA256(app_secret, app_key + raw_body)`.
 * VERIFY against the "Webhooks overview" doc for your region.
 */
export function verifyWebhookSignature(opts: {
  appKey: string;
  appSecret: string;
  rawBody: string;
  signature: string | undefined;
}): boolean {
  if (!opts.signature) return false;
  const expected = createHmac("sha256", opts.appSecret).update(`${opts.appKey}${opts.rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
