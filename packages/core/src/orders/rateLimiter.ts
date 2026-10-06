import { Redis } from "ioredis";

/**
 * Rate limiting implementations (#25).
 * In-memory for tests, Redis token bucket for production.
 */

export interface RateLimiter {
  acquire(key: string): Promise<void>;
}

/**
 * In-memory token bucket rate limiter for testing.
 * Tracks per-key buckets and allows burst.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<
    string,
    { tokens: number; lastRefillAt: number }
  >();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {}

  async acquire(key: string): Promise<void> {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.burst, lastRefillAt: nowMs };
      this.buckets.set(key, bucket);
    }

    const elapsedSeconds = (nowMs - bucket.lastRefillAt) / 1000;
    const tokensToAdd = elapsedSeconds * this.ratePerSecond;
    bucket.tokens = Math.min(this.burst, bucket.tokens + tokensToAdd);
    bucket.lastRefillAt = nowMs;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    const waitMs = (1 - bucket.tokens) / this.ratePerSecond * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    bucket.tokens = 0;
  }
}

/**
 * Redis-backed token bucket rate limiter using Lua scripts.
 * Ensures coordinated rate limiting across workers.
 */
export function createRedisRateLimiter(opts: RedisRateLimiterOptions): RedisRateLimiter {
  return new RedisRateLimiter(opts);
}

export interface RedisRateLimiterOptions {
  redisUrl: string;
  ratePerSecond: number;
  burst: number;
  keyPrefix?: string;
  /** Give up after waiting this long in total (default 60s). */
  maxWaitMs?: number;
}

/**
 * Atomic token bucket shared by all processes. Returns 0 when a token was taken,
 * otherwise the milliseconds to wait before the next token is available.
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1]) or burst
local ts = tonumber(state[2]) or now
tokens = math.min(burst, tokens + math.max(0, now - ts) / 1000 * rate)
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
else
  wait = math.ceil((1 - tokens) / rate * 1000)
end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil(burst / rate * 1000) + 60000)
return wait
`;

export class RedisRateLimiter implements RateLimiter {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly maxWaitMs: number;

  constructor(private readonly opts: RedisRateLimiterOptions) {
    this.redis = new Redis(opts.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
    this.keyPrefix = opts.keyPrefix ?? "oms:rate:";
    this.maxWaitMs = opts.maxWaitMs ?? 60_000;
  }

  async acquire(key: string): Promise<void> {
    const started = Date.now();
    for (;;) {
      const wait = Number(
        await this.redis.eval(TOKEN_BUCKET_LUA, 1, this.keyPrefix + key, Date.now(), this.opts.ratePerSecond, this.opts.burst),
      );
      if (wait <= 0) return;
      if (Date.now() - started + wait > this.maxWaitMs) throw new Error(`Rate limiter wait for ${key} exceeded ${this.maxWaitMs}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
