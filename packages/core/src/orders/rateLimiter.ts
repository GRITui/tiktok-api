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
export function createRedisRateLimiter(opts: {
  redisUrl: string;
  ratePerSecond: number;
  burst: number;
}): RateLimiter {
  return new RedisRateLimiter(opts);
}

class RedisRateLimiter implements RateLimiter {
  private redis: any;
  private readonly ratePerSecond: number;
  private readonly burst: number;
  private readonly keyPrefix: string;

  constructor(opts: {
    redisUrl: string;
    ratePerSecond: number;
    burst: number;
  }) {
    this.ratePerSecond = opts.ratePerSecond;
    this.burst = opts.burst;
    this.keyPrefix = "rate:";
    // Dynamic import will be done in acquire() to avoid load-time issues
  }

  async acquire(key: string): Promise<void> {
    if (!this.redis) {
      // Lazy load ioredis
      const RedisModule = await import("ioredis");
      const Redis = RedisModule.default || RedisModule;
      this.redis = new (Redis as any)(process.env.REDIS_URL || "redis://localhost:6379");
    }

    const bucketKey = `${this.keyPrefix}${key}`;
    const now = Date.now();

    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local rate = tonumber(ARGV[2])
      local burst = tonumber(ARGV[3])

      local bucket = redis.call('HGETALL', key)
      local tokens = tonumber(bucket[2] or burst)
      local last_refill = tonumber(bucket[4] or now)

      local elapsed = (now - last_refill) / 1000
      tokens = math.min(burst, tokens + elapsed * rate)

      if tokens >= 1 then
        tokens = tokens - 1
        redis.call('HSET', key, 'tokens', tokens, 'last_refill', now)
        redis.call('EXPIRE', key, 3600)
        return 1
      else
        local wait_ms = (1 - tokens) / rate * 1000
        return wait_ms
      end
    `;

    let attempts = 0;
    while (attempts < 100) {
      const result = await this.redis.eval(
        luaScript,
        1,
        bucketKey,
        now,
        this.ratePerSecond,
        this.burst,
      );

      if (result === 1) {
        return;
      }

      const waitMs = Math.max(1, Math.ceil(result as number));
      await new Promise((r) => setTimeout(r, waitMs));
      attempts++;
    }

    throw new Error(`Rate limiter ${key} timeout after 100 attempts`);
  }
}
