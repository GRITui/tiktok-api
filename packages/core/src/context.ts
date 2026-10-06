import type { Db } from "@oms/db";
import type { AuthApi, OrdersApi, ShopContext, TikTokClient } from "@oms/tiktok-sdk";
import type { TokenCipher } from "./crypto.js";
import type { QueueProducer } from "./queues.js";

export interface CoreConfig {
  appKey: string;
  appSecret: string;
  serviceId: string;
  /** Days of history to import on first connect. */
  backfillDays: number;
  /** Minutes subtracted from the poll cursor to catch late updates. */
  pollOverlapMinutes: number;
  /** Directory where generated PDFs/CSVs are written. */
  fileStorageDir: string;
}

/**
 * Everything core services need. Built once per process (API or worker) and passed explicitly,
 * which keeps services testable with fakes.
 */
export interface Deps {
  db: Db;
  config: CoreConfig;
  cipher: TokenCipher;
  queues: QueueProducer;
  /** Signed Open API client (open-api.tiktokglobalshop.com). */
  tts: TikTokClient;
  /** Token endpoints (auth.tiktok-shops.com). */
  auth: AuthApi;
  now: () => Date;
}

/** A shop's credentials ready for a shop-scoped API call. */
export interface ResolvedShop extends ShopContext {
  shopId: string;
  region: string;
}

export type { OrdersApi };
