/**
 * Order ingestion — LANE D (Sprint 2: #19 #20 #21 #22 #23 #24 #25, plus #53 package sync inside the upsert).
 * Contract: signatures below are used by other lanes; keep them stable.
 */
import type { Order, WebhookEnvelope } from "@oms/tiktok-sdk";
import type { Deps } from "../context.js";
import { notImplemented } from "../errors.js";

/**
 * Upsert orders, line items, packages, order_packages and package_line_items in one transaction per order.
 * Skips an order whose stored tts_updated_at is newer than the incoming update_time.
 * Sets orders.recipient_hash = sha256 of the normalized recipient address.
 */
export async function upsertOrders(
  _deps: Deps,
  _shopId: string,
  _orders: Order[],
): Promise<{ written: number; skipped: number }> {
  return notImplemented("upsertOrders");
}

/** Fetch Get Order Detail (batched by 50) and upsert. Used after ship actions and by webhook processing. */
export async function refreshOrders(_deps: Deps, _shopId: string, _orderIds: string[]): Promise<void> {
  return notImplemented("refreshOrders");
}

/** Store a verified webhook (dedupe on tts_notification_id) and enqueue Queues.webhook. */
export async function ingestWebhook(
  _deps: Deps,
  _event: WebhookEnvelope,
): Promise<{ eventId: number | null; duplicate: boolean }> {
  return notImplemented("ingestWebhook");
}

/**
 * Process one stored webhook. Dispatch by type:
 *  ORDER_STATUS_CHANGE / RECIPIENT_ADDRESS_UPDATE → refreshOrders
 *  PACKAGE_UPDATE → logistics.handlePackageUpdate
 *  seller deauthorization → auth.markAuthorizationRevoked
 *  others → mark processed (handled in later sprints)
 * Sets processed_at, or increments attempts + error and rethrows so the queue retries.
 */
export async function processWebhookEvent(_deps: Deps, _eventId: number): Promise<void> {
  return notImplemented("processWebhookEvent");
}

/** Idempotently subscribe the shop to the webhook event types the OMS needs (Events API). */
export async function ensureWebhookSubscriptions(_deps: Deps, _shopId: string): Promise<void> {
  return notImplemented("ensureWebhookSubscriptions");
}

/** Incremental poll from sync_cursors(shop,"orders") minus overlap; advances the cursor after each committed page. */
export async function runOrderSync(_deps: Deps, _shopId: string): Promise<{ orders: number }> {
  return notImplemented("runOrderSync");
}

/** Resumable historical import in time windows; updates shops.backfill_* fields. Calls ensureWebhookSubscriptions first. */
export async function runBackfill(_deps: Deps, _shopId: string): Promise<void> {
  return notImplemented("runBackfill");
}
