import { createTestDb } from "@oms/db/testing";
import { AuthApi, TikTokClient } from "@oms/tiktok-sdk";
import type { CoreConfig, Deps } from "./context.js";
import { TokenCipher } from "./crypto.js";
import { RecordingQueue } from "./queues.js";

export type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** JSON envelope helper for fake TikTok responses. */
export const ttsOk = (data: unknown) => new Response(JSON.stringify({ code: 0, message: "Success", request_id: "req-test", data }));
export const ttsErr = (code: number, message: string, status = 200) =>
  new Response(JSON.stringify({ code, message, request_id: "req-test" }), { status });

/**
 * Deps for tests: in-memory Postgres (migrated), recording queue, and TikTok clients whose fetch
 * goes to `handler`. Set `handler` per test via the returned `setFetch`.
 */
export async function createTestDeps(overrides: Partial<CoreConfig> = {}) {
  const { db, close } = await createTestDb();
  let handler: FetchHandler = (url) => {
    throw new Error(`Unexpected TikTok call: ${url.pathname}`);
  };
  const calls: { url: URL; init: RequestInit }[] = [];
  const fakeFetch = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  const queues = new RecordingQueue();
  const config: CoreConfig = {
    appKey: "test-key",
    appSecret: "test-secret",
    serviceId: "svc",
    backfillDays: 90,
    pollOverlapMinutes: 10,
    fileStorageDir: "./var/test-files",
    ...overrides,
  };
  let now = new Date("2026-10-06T00:00:00Z");
  const deps: Deps = {
    db,
    config,
    cipher: new TokenCipher(["ab".repeat(32)]),
    queues,
    tts: new TikTokClient({ appKey: config.appKey, appSecret: config.appSecret, fetch: fakeFetch, sleep: async () => {} }),
    auth: new AuthApi({ appKey: config.appKey, appSecret: config.appSecret, fetch: fakeFetch }),
    now: () => now,
  };
  return {
    deps,
    queues,
    calls,
    setFetch: (h: FetchHandler) => { handler = h; },
    setNow: (d: Date) => { now = d; },
    close,
  };
}
