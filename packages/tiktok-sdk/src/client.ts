import { TikTokApiError } from "./errors.js";
import { signRequest } from "./signing.js";
import type { ApiEnvelope } from "./types.js";

export interface TikTokClientOptions {
  appKey: string;
  appSecret: string;
  baseUrl?: string;
  /** Max attempts for retryable failures (429 / 5xx / network). */
  maxAttempts?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accessToken?: string;
  /** Required for shop-scoped endpoints (orders, fulfillment, returns, ...). */
  shopCipher?: string;
}

const DEFAULT_BASE_URL = "https://open-api.tiktokglobalshop.com";

export class TikTokClient {
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: TikTokClientOptions) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get appKey(): string {
    return this.opts.appKey;
  }

  async request<T>(req: RequestOptions): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.send<T>(req);
      } catch (err) {
        lastError = err;
        const retryable = !(err instanceof TikTokApiError) || err.isRetryable;
        if (!retryable || attempt === this.maxAttempts) throw err;
        await this.sleep(Math.min(250 * 2 ** (attempt - 1), 4000) + Math.random() * 100);
      }
    }
    throw lastError;
  }

  private async send<T>(req: RequestOptions): Promise<T> {
    const contentType = "application/json";
    const rawBody = req.body === undefined ? undefined : JSON.stringify(req.body);
    const query: Record<string, string | number | undefined> = {
      ...req.query,
      app_key: this.opts.appKey,
      timestamp: Math.floor(this.now() / 1000),
      shop_cipher: req.shopCipher,
    };
    query.sign = signRequest({
      appSecret: this.opts.appSecret,
      path: req.path,
      query,
      body: rawBody,
      contentType,
    });

    const url = new URL(req.path, this.baseUrl);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { "content-type": contentType };
    if (req.accessToken) headers["x-tts-access-token"] = req.accessToken;

    const res = await this.fetchImpl(url, { method: req.method, headers, body: rawBody });
    const text = await res.text();
    let envelope: ApiEnvelope<T>;
    try {
      envelope = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new TikTokApiError(`Non-JSON response: ${text.slice(0, 200)}`, -1, undefined, res.status, req.path);
    }
    if (!res.ok || envelope.code !== 0) {
      throw new TikTokApiError(envelope.message, envelope.code, envelope.request_id, res.status, req.path);
    }
    return envelope.data as T;
  }
}
