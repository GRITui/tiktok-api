import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createDb } from "@oms/db";
import { AuthApi, TikTokClient } from "@oms/tiktok-sdk";
import { Queue } from "bullmq";
import type { CoreConfig, Deps } from "./context.js";
import { TokenCipher } from "./crypto.js";
import { createRedisRateLimiter } from "./orders/rateLimiter.js";
import type { EnqueueOptions, QueueName, QueueProducer } from "./queues.js";

/** BullMQ-backed producer. One Queue instance per name, created lazily. */
export class BullMqProducer implements QueueProducer {
  private readonly queues = new Map<string, Queue>();
  constructor(private readonly redisUrl: string) {}

  async enqueue(name: QueueName, data: Record<string, unknown>, opts?: EnqueueOptions) {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: { url: this.redisUrl } });
      this.queues.set(name, q);
    }
    await q.add(name, data, {
      jobId: opts?.jobId,
      delay: opts?.delayMs,
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

const req = (env: NodeJS.ProcessEnv, k: string) => {
  const v = env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};

/** Build process-wide Deps from environment variables. Shared by apps/api and apps/worker. */
export function createDepsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const config: CoreConfig = {
    appKey: req(env, "TTS_APP_KEY"),
    appSecret: req(env, "TTS_APP_SECRET"),
    serviceId: env.TTS_SERVICE_ID ?? "",
    backfillDays: Number(env.BACKFILL_DAYS ?? 90),
    pollOverlapMinutes: Number(env.POLL_OVERLAP_MINUTES ?? 10),
    // API and worker run from different package dirs; anchor relative paths at the repo root so both agree.
    fileStorageDir: resolveFromRepoRoot(env.FILE_STORAGE_DIR ?? "./var/files"),
  };
  const { db, close: closeDb } = createDb(env.DATABASE_URL ?? "postgres://oms:oms@localhost:5432/oms");
  const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
  const queues = new BullMqProducer(redisUrl);
  const rateLimiter = createRedisRateLimiter({
    redisUrl,
    ratePerSecond: Number(env.TTS_RATE_PER_SECOND ?? 10),
    burst: Number(env.TTS_RATE_BURST ?? 20),
  });
  const deps: Deps = {
    db,
    config,
    cipher: TokenCipher.fromEnv(env.TOKEN_ENCRYPTION_KEY),
    queues,
    tts: new TikTokClient({
      appKey: config.appKey,
      appSecret: config.appSecret,
      baseUrl: env.TTS_API_BASE_URL,
      // Shared across API and worker processes; key = shop cipher + API group (#25).
      rateLimiter,
    }),
    auth: new AuthApi({ appKey: config.appKey, appSecret: config.appSecret, authBaseUrl: env.TTS_AUTH_BASE_URL }),
    now: () => new Date(),
  };
  return { deps, close: async () => { await queues.close(); await rateLimiter.close(); await closeDb(); } };
}

/** Directory containing pnpm-workspace.yaml above `from` (falls back to `from`). */
export function findRepoRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

export function resolveFromRepoRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(findRepoRoot(), p);
}
