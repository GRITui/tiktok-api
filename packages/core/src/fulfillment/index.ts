/**
 * Ship, batch ship, labels, guards — LANE F2 (Sprint 4: #59 #54 #32 #58 #33).
 * Contract: signatures below are used by apps/api and apps/worker; keep them stable.
 */
import type { Deps } from "../context.js";
import { notImplemented } from "../errors.js";
import type { ShipResult } from "../oms/types.js";

export interface AuditEntry {
  actor: string;
  shopId?: string | null;
  action: string;
  targetId?: string | null;
  request?: unknown;
  response?: unknown;
  ttsRequestId?: string | null;
  ok: boolean;
}

export async function recordAudit(_deps: Deps, _entry: AuditEntry): Promise<void> {
  return notImplemented("recordAudit");
}

/**
 * Run `fn` at most once per `key` (#59). Concurrent callers with the same key get
 * OmsError("in_progress", 409); a completed key returns the stored response with replayed=true.
 * Every call (success or failure) is written to audit_log.
 */
export async function withIdempotency<T>(
  _deps: Deps,
  _opts: { key: string; action: string; targetId: string; actor: string; shopId?: string },
  _fn: () => Promise<{ result: T; ttsRequestId?: string }>,
): Promise<{ result: T; replayed: boolean }> {
  return notImplemented("withIdempotency");
}

/**
 * Pre-ship guard (#54): re-fetch the package's orders via orders.refreshOrders, then throw
 * OmsError("not_shippable", 409, { reason }) if any order is not AWAITING_SHIPMENT, is FBT,
 * or its recipient_hash differs from packages.shipped_recipient_hash (when set).
 */
export async function assertShippable(_deps: Deps, _packageId: string): Promise<void> {
  return notImplemented("assertShippable");
}

/** Ship one TikTok Shipping package (#32). Uses the package's stored handover method/slot unless overridden. */
export async function shipPackage(
  _deps: Deps,
  _input: {
    packageId: string;
    actor: string;
    idempotencyKey: string;
    handoverMethod?: "PICKUP" | "DROP_OFF";
    pickupSlot?: { start: number; end: number };
  },
): Promise<ShipResult> {
  return notImplemented("shipPackage");
}

/** Create a jobs row (type "batch_ship") with one job_item per package and enqueue Queues.batchShip. (#58) */
export async function startBatchShip(_deps: Deps, _input: { packageIds: string[]; actor: string }): Promise<{ jobId: string }> {
  return notImplemented("startBatchShip");
}

/** Process pending items only (so retries never re-ship successes), grouped by shop, chunked for Batch Ship. (#58) */
export async function runBatchShip(_deps: Deps, _jobId: string): Promise<void> {
  return notImplemented("runBatchShip");
}

export type ShippingDocumentType = "SHIPPING_LABEL" | "PACKING_SLIP" | "SHIPPING_LABEL_AND_PACKING_SLIP";

/** Create a jobs row (type "labels") and enqueue Queues.labels. (#33) */
export async function startLabelJob(
  _deps: Deps,
  _input: { packageIds: string[]; documentType: ShippingDocumentType; actor: string },
): Promise<{ jobId: string }> {
  return notImplemented("startLabelJob");
}

/** Fetch each document, merge into one PDF under config.fileStorageDir, set jobs.result = { filePath }. (#33) */
export async function runLabelJob(_deps: Deps, _jobId: string): Promise<void> {
  return notImplemented("runLabelJob");
}
