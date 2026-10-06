/**
 * Ship, batch ship, labels, guards — LANE F2 (Sprint 4: #59 #54 #32 #58 #33).
 * Contract: signatures below are used by apps/api and apps/worker; keep them stable.
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@oms/db";
import type { Deps } from "../context.js";
import { OmsError } from "../errors.js";
import { refreshOrders } from "../orders/index.js";
import { getShopContext } from "../auth/index.js";
import { Queues } from "../queues.js";
import type { ShipResult } from "../oms/types.js";
import { FulfillmentApi, type HandoverMethod } from "@oms/tiktok-sdk";
import { mkdir } from "fs/promises";
import { writeFile } from "fs/promises";
import { PDFDocument } from "pdf-lib";

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

export async function recordAudit(deps: Deps, entry: AuditEntry): Promise<void> {
  await deps.db.insert(schema.auditLog).values({
    actor: entry.actor,
    shopId: entry.shopId || null,
    action: entry.action,
    targetId: entry.targetId || null,
    request: entry.request ? JSON.stringify(entry.request) : null,
    response: entry.response ? JSON.stringify(entry.response) : null,
    ttsRequestId: entry.ttsRequestId || null,
    ok: entry.ok,
  });
}

/**
 * Run `fn` at most once per `key` (#59). Concurrent callers with the same key get
 * OmsError("in_progress", 409); a completed key returns the stored response with replayed=true.
 * Every call (success or failure) is written to audit_log.
 */
export async function withIdempotency<T>(
  deps: Deps,
  opts: { key: string; action: string; targetId: string; actor: string; shopId?: string },
  fn: () => Promise<{ result: T; ttsRequestId?: string }>,
): Promise<{ result: T; replayed: boolean }> {
  const { key, action, targetId, actor, shopId } = opts;

  // Try to insert a new idempotency key with status "in_progress"
  const existing = await deps.db
    .select()
    .from(schema.idempotencyKeys)
    .where(eq(schema.idempotencyKeys.key, key))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;

    // Guard against key reuse with different action/targetId
    if (row.action !== action || row.targetId !== targetId) {
      throw new OmsError("idempotency_key_mismatch", "Idempotency key used for a different action", 422);
    }

    if (row.status === "in_progress") {
      throw new OmsError("in_progress", "Request is already in progress", 409);
    }

    if (row.status === "succeeded") {
      // Return the stored response
      await recordAudit(deps, {
        actor,
        shopId,
        action,
        targetId,
        ok: true,
        ttsRequestId: undefined,
      });
      return { result: row.response as T, replayed: true };
    }

    if (row.status === "failed") {
      // Allow retry: update to in_progress atomically
      const updated = await deps.db
        .update(schema.idempotencyKeys)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(and(eq(schema.idempotencyKeys.key, key), eq(schema.idempotencyKeys.status, "failed")))
        .returning();

      if (updated.length === 0) {
        // Race condition: someone else updated it
        throw new OmsError("in_progress", "Request is already in progress", 409);
      }
    }
  } else {
    // Try to insert
    try {
      await deps.db.insert(schema.idempotencyKeys).values({
        key,
        action,
        targetId,
        status: "in_progress",
      });
    } catch (err) {
      // Insertion failed (likely due to conflict), try to read again
      const retry = await deps.db
        .select()
        .from(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.key, key))
        .limit(1);

      if (retry.length > 0) {
        // Recursive call to handle the race condition
        return withIdempotency(deps, opts, fn);
      }
      throw err;
    }
  }

  // Run the function
  try {
    const { result, ttsRequestId } = await fn();

    // Store success
    await deps.db
      .update(schema.idempotencyKeys)
      .set({
        status: "succeeded",
        response: result as unknown,
        updatedAt: new Date(),
      })
      .where(eq(schema.idempotencyKeys.key, key));

    await recordAudit(deps, {
      actor,
      shopId,
      action,
      targetId,
      response: result as unknown,
      ttsRequestId,
      ok: true,
    });

    return { result, replayed: false };
  } catch (err) {
    // Store failure
    const errorMessage = err instanceof Error ? err.message : String(err);
    let errorCode: string | undefined;
    let requestId: string | undefined;

    if (err && typeof err === "object" && "code" in err) {
      errorCode = String(err.code);
    }
    if (err && typeof err === "object" && "requestId" in err) {
      requestId = String(err.requestId);
    }

    await deps.db
      .update(schema.idempotencyKeys)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(schema.idempotencyKeys.key, key));

    await recordAudit(deps, {
      actor,
      shopId,
      action,
      targetId,
      ok: false,
      ttsRequestId: requestId,
      response: { error: errorMessage, code: errorCode },
    });

    throw err;
  }
}

/**
 * Pre-ship guard (#54): re-fetch the package's orders via orders.refreshOrders, then throw
 * OmsError("not_shippable", 409, { reason, orderId }) if any order is not AWAITING_SHIPMENT, is FBT,
 * or its recipient_hash differs from packages.shipped_recipient_hash (when set).
 */
export async function assertShippable(deps: Deps, packageId: string): Promise<void> {
  // Load the package
  const pkg = await deps.db
    .select()
    .from(schema.packages)
    .where(eq(schema.packages.id, packageId))
    .limit(1);

  if (pkg.length === 0) {
    throw new OmsError("not_found", "Package not found", 404);
  }

  const packageData = pkg[0]!;

  // Check if already shipped
  if (packageData.shippedAt) {
    throw new OmsError("not_shippable", "Package already shipped", 409, { reason: "already_shipped" });
  }

  // Load order IDs for this package
  const orderPackages = await deps.db
    .select({ orderId: schema.orderPackages.orderId })
    .from(schema.orderPackages)
    .where(eq(schema.orderPackages.packageId, packageId));

  const orderIds = orderPackages.map((op) => op.orderId);

  if (orderIds.length === 0) {
    throw new OmsError("not_shippable", "Package has no orders", 409, { reason: "no_orders" });
  }

  // Refresh orders from TikTok
  await refreshOrders(deps, packageData.shopId, orderIds);

  // Re-read orders to check their status
  const orders = await deps.db
    .select()
    .from(schema.orders)
    .where(inArray(schema.orders.id, orderIds));

  for (const order of orders) {
    // Check status
    if (order.status !== "AWAITING_SHIPMENT") {
      throw new OmsError("not_shippable", `Order status is not AWAITING_SHIPMENT`, 409, {
        reason: `status_${order.status}`,
        orderId: order.id,
      });
    }

    // Check fulfillment type
    if (order.fulfillmentType === "FULFILLMENT_BY_TIKTOK") {
      throw new OmsError("not_shippable", "Order is fulfilled by TikTok", 409, {
        reason: "fbt",
        orderId: order.id,
      });
    }

    // Check recipient hash if package has a shipped recipient hash set
    if (packageData.shippedRecipientHash && packageData.shippedRecipientHash !== order.recipientHash) {
      throw new OmsError("not_shippable", "Order recipient address changed", 409, {
        reason: "address_changed",
        orderId: order.id,
      });
    }
  }

  // TODO(#37): Check for pending cancellation
}

/** Ship one TikTok Shipping package (#32). Uses the package's stored handover method/slot unless overridden. */
export async function shipPackage(
  deps: Deps,
  input: {
    packageId: string;
    actor: string;
    idempotencyKey: string;
    handoverMethod?: "PICKUP" | "DROP_OFF";
    pickupSlot?: { start: number; end: number };
  },
): Promise<ShipResult> {
  const { packageId, actor, idempotencyKey, handoverMethod, pickupSlot } = input;

  const result = await withIdempotency(
    deps,
    {
      key: idempotencyKey,
      action: "ship_package",
      targetId: packageId,
      actor,
    },
    async () => {
      await assertShippable(deps, packageId);

      // Load package and shop
      const pkg = await deps.db
        .select()
        .from(schema.packages)
        .where(eq(schema.packages.id, packageId))
        .limit(1);

      if (pkg.length === 0) {
        throw new OmsError("not_found", "Package not found", 404);
      }

      const packageData = pkg[0]!;

      // Determine handover method
      let resolvedHandoverMethod: HandoverMethod | undefined = handoverMethod;
      let resolvedPickupSlot = pickupSlot;

      if (!resolvedHandoverMethod) {
        // Check package stored handover method
        if (packageData.handoverMethod) {
          resolvedHandoverMethod = packageData.handoverMethod as HandoverMethod;
          if (resolvedHandoverMethod === "PICKUP" && !resolvedPickupSlot) {
            resolvedPickupSlot = {
              start: packageData.pickupSlotStart || 0,
              end: packageData.pickupSlotEnd || 0,
            };
          }
        } else {
          // Check warehouse default handover method
          const warehouse = await deps.db
            .select()
            .from(schema.warehouses)
            .where(and(eq(schema.warehouses.shopId, packageData.shopId), eq(schema.warehouses.id, packageData.warehouseId || "")))
            .limit(1);

          if (warehouse.length > 0 && warehouse[0]?.defaultHandoverMethod) {
            resolvedHandoverMethod = warehouse[0].defaultHandoverMethod as HandoverMethod;
          }
        }
      }

      if (!resolvedHandoverMethod) {
        throw new OmsError("handover_required", "Handover method is required", 400);
      }

      if (resolvedHandoverMethod === "PICKUP" && !resolvedPickupSlot) {
        throw new OmsError("handover_required", "Pickup slot is required for PICKUP handover", 400);
      }

      // Get shop context
      const ctx = await getShopContext(deps, packageData.shopId);

      // Call TikTok API
      const fulfillmentApi = new FulfillmentApi(deps.tts);
      await fulfillmentApi.shipPackage(ctx, packageId, {
        handover_method: resolvedHandoverMethod,
        pickup_slot: resolvedPickupSlot ? { start_time: resolvedPickupSlot.start, end_time: resolvedPickupSlot.end } : undefined,
      });

      // Get package detail
      const detail = await fulfillmentApi.getPackageDetail(ctx, packageId);

      // Load orders for this package
      const orderPackages = await deps.db
        .select({ orderId: schema.orderPackages.orderId })
        .from(schema.orderPackages)
        .where(eq(schema.orderPackages.packageId, packageId));

      const orderIds = orderPackages.map((op) => op.orderId);

      // Get current orders to get recipient hash
      const orders = await deps.db
        .select()
        .from(schema.orders)
        .where(inArray(schema.orders.id, orderIds));

      const recipientHash = orders.length > 0 ? orders[0]?.recipientHash : null;

      // Update package
      await deps.db
        .update(schema.packages)
        .set({
          status: detail.package_status,
          trackingNumber: detail.tracking_number || null,
          shippingProviderId: detail.shipping_provider_id,
          shippingProvider: detail.shipping_provider_name,
          handoverMethod: detail.handover_method || resolvedHandoverMethod,
          pickupSlotStart: detail.pickup_slot ? detail.pickup_slot.start_time : (resolvedPickupSlot?.start || null),
          pickupSlotEnd: detail.pickup_slot ? detail.pickup_slot.end_time : (resolvedPickupSlot?.end || null),
          shippedAt: new Date(),
          shippedRecipientHash: recipientHash,
          updatedAt: new Date(),
        })
        .where(eq(schema.packages.id, packageId));

      // Refresh orders
      await refreshOrders(deps, packageData.shopId, orderIds);

      return {
        result: {
          packageId,
          status: detail.package_status,
          trackingNumber: detail.tracking_number || null,
          replayed: false,
        },
        ttsRequestId: undefined,
      };
    },
  );

  return result.result;
}

/** Create a jobs row (type "batch_ship") with one job_item per package and enqueue Queues.batchShip. (#58) */
export async function startBatchShip(
  deps: Deps,
  input: { packageIds: string[]; actor: string },
): Promise<{ jobId: string }> {
  const { packageIds, actor } = input;

  if (packageIds.length < 1 || packageIds.length > 500) {
    throw new OmsError("invalid_input", "packageIds must be 1..500", 400);
  }

  // Verify all IDs are unique
  if (new Set(packageIds).size !== packageIds.length) {
    throw new OmsError("invalid_input", "packageIds must be unique", 400);
  }

  // Create a jobs row
  const jobs = await deps.db
    .insert(schema.jobs)
    .values({
      type: "batch_ship",
      status: "queued",
      total: packageIds.length,
      params: { actor },
      createdBy: actor,
    })
    .returning();

  const job = jobs[0];
  if (!job) {
    throw new Error("Failed to create job");
  }

  // Create job items
  const items = packageIds.map((packageId) => ({
    jobId: job.id,
    targetId: packageId,
    status: "pending" as const,
  }));

  await deps.db.insert(schema.jobItems).values(items);

  // Enqueue
  await deps.queues.enqueue(Queues.batchShip, { jobId: job.id }, { jobId: `batch-${job.id}` });

  return { jobId: job.id };
}

/** Process pending items only (so retries never re-ship successes), grouped by shop, chunked for Batch Ship. (#58) */
export async function runBatchShip(deps: Deps, jobId: string): Promise<void> {
  // Get the job
  const jobs = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));

  if (jobs.length === 0) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const job = jobs[0]!;

  // Update status to running
  await deps.db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, jobId));

  // Get pending items only
  const pendingItems = await deps.db
    .select()
    .from(schema.jobItems)
    .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.status, "pending")));

  let succeeded = 0;
  let failed = 0;

  // Group by shop
  const shopMap = new Map<string, string[]>();

  for (const item of pendingItems) {
    const pkg = await deps.db
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.id, item.targetId))
      .limit(1);

    if (pkg.length === 0) {
      await deps.db
        .update(schema.jobItems)
        .set({ status: "failed", error: "Package not found" })
        .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, item.targetId)));
      failed++;
      continue;
    }

    const shopId = pkg[0]!.shopId;
    if (!shopMap.has(shopId)) {
      shopMap.set(shopId, []);
    }
    shopMap.get(shopId)!.push(item.targetId);
  }

  // Process per shop
  for (const [shopId, packageIds] of shopMap.entries()) {
    // Chunk up to 50 per call
    for (let i = 0; i < packageIds.length; i += 50) {
      const chunk = packageIds.slice(i, i + 50);

      // Get packages for this chunk
      const pkgs = await deps.db
        .select()
        .from(schema.packages)
        .where(inArray(schema.packages.id, chunk));

      // Resolve handover for each package
      const shipItems: Array<{ id: string; handover_method?: HandoverMethod; pickup_slot?: { start_time: number; end_time: number } }> = [];
      const itemMap = new Map(pkgs.map((p) => [p.id, p]));

      for (const packageId of chunk) {
        const pkg = itemMap.get(packageId);
        if (!pkg) continue;

        let handoverMethod: HandoverMethod | undefined = pkg.handoverMethod as HandoverMethod | undefined;
        let pickupSlot: { start_time: number; end_time: number } | undefined;

        if (!handoverMethod) {
          const warehouse = await deps.db
            .select()
            .from(schema.warehouses)
            .where(and(eq(schema.warehouses.shopId, shopId), eq(schema.warehouses.id, pkg.warehouseId || "")))
            .limit(1);

          if (warehouse.length > 0 && warehouse[0]?.defaultHandoverMethod) {
            handoverMethod = warehouse[0].defaultHandoverMethod as HandoverMethod;
          }
        }

        if (!handoverMethod) {
          await deps.db
            .update(schema.jobItems)
            .set({ status: "failed", error: "Handover method required" })
            .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, packageId)));
          failed++;
          continue;
        }

        if (handoverMethod === "PICKUP" && !pkg.pickupSlotStart) {
          await deps.db
            .update(schema.jobItems)
            .set({ status: "failed", error: "Pickup slot required for PICKUP handover" })
            .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, packageId)));
          failed++;
          continue;
        }

        if (pkg.pickupSlotStart && pkg.pickupSlotEnd) {
          pickupSlot = { start_time: pkg.pickupSlotStart, end_time: pkg.pickupSlotEnd };
        }

        shipItems.push({
          id: packageId,
          handover_method: handoverMethod,
          pickup_slot: pickupSlot,
        });
      }

      if (shipItems.length === 0) {
        continue;
      }

      // Get shop context
      const ctx = await getShopContext(deps, shopId);

      // Call batch ship
      const fulfillmentApi = new FulfillmentApi(deps.tts);
      const result = await fulfillmentApi.batchShipPackages(ctx, { packages: shipItems });

      // Process errors
      const errorMap = new Map((result.errors || []).map((e) => [e.detail?.package_id, e]));

      // Process successes and failures
      for (const shipItem of shipItems) {
        if (errorMap.has(shipItem.id)) {
          const error = errorMap.get(shipItem.id)!;
          await deps.db
            .update(schema.jobItems)
            .set({
              status: "failed",
              error: `${error.code}: ${error.message}`,
            })
            .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, shipItem.id)));
          failed++;
        } else {
          // Get package detail
          const detail = await fulfillmentApi.getPackageDetail(ctx, shipItem.id);

          // Get orders for this package
          const orderPackages = await deps.db
            .select({ orderId: schema.orderPackages.orderId })
            .from(schema.orderPackages)
            .where(eq(schema.orderPackages.packageId, shipItem.id));

          const orderIds = orderPackages.map((op) => op.orderId);

          // Get current orders to get recipient hash
          const orders = await deps.db
            .select()
            .from(schema.orders)
            .where(inArray(schema.orders.id, orderIds));

          const recipientHash = orders.length > 0 ? orders[0]?.recipientHash : null;

          // Update package
          await deps.db
            .update(schema.packages)
            .set({
              status: detail.package_status,
              trackingNumber: detail.tracking_number || null,
              shippingProviderId: detail.shipping_provider_id,
              shippingProvider: detail.shipping_provider_name,
              handoverMethod: detail.handover_method,
              pickupSlotStart: detail.pickup_slot ? detail.pickup_slot.start_time : null,
              pickupSlotEnd: detail.pickup_slot ? detail.pickup_slot.end_time : null,
              shippedAt: new Date(),
              shippedRecipientHash: recipientHash,
              updatedAt: new Date(),
            })
            .where(eq(schema.packages.id, shipItem.id));

          // Update item
          await deps.db
            .update(schema.jobItems)
            .set({
              status: "succeeded",
              response: { status: detail.package_status, trackingNumber: detail.tracking_number || null },
            })
            .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, shipItem.id)));

          // Refresh orders
          await refreshOrders(deps, shopId, orderIds);

          succeeded++;
        }
      }

      // Record audit
      await recordAudit(deps, {
        actor: job.createdBy || "system",
        shopId,
        action: "batch_ship_chunk",
        targetId: jobId,
        request: { packageIds: chunk },
        response: { succeeded: succeeded, failed: failed },
        ok: failed === 0,
      });
    }
  }

  // Update job status
  const status = failed === 0 ? "succeeded" : failed === pendingItems.length ? "failed" : "partial";

  await deps.db
    .update(schema.jobs)
    .set({
      status,
      succeeded,
      failed,
      finishedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));
}

export type ShippingDocumentType = "SHIPPING_LABEL" | "PACKING_SLIP" | "SHIPPING_LABEL_AND_PACKING_SLIP";

let documentFetcher: ((url: string) => Promise<ArrayBuffer>) | null = null;

export function setDocumentFetcher(fn: (url: string) => Promise<ArrayBuffer>) {
  documentFetcher = fn;
}

async function fetchDocument(url: string): Promise<ArrayBuffer> {
  if (documentFetcher) {
    return documentFetcher(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch document: ${response.statusText}`);
  }
  return response.arrayBuffer();
}

/** Create a jobs row (type "labels") and enqueue Queues.labels. (#33) */
export async function startLabelJob(
  deps: Deps,
  input: { packageIds: string[]; documentType: ShippingDocumentType; actor: string },
): Promise<{ jobId: string }> {
  const { packageIds, documentType, actor } = input;

  if (packageIds.length < 1 || packageIds.length > 500) {
    throw new OmsError("invalid_input", "packageIds must be 1..500", 400);
  }

  // Verify all IDs are unique
  if (new Set(packageIds).size !== packageIds.length) {
    throw new OmsError("invalid_input", "packageIds must be unique", 400);
  }

  // Create a jobs row
  const jobs = await deps.db
    .insert(schema.jobs)
    .values({
      type: "labels",
      status: "queued",
      total: packageIds.length,
      params: { documentType, actor },
      createdBy: actor,
    })
    .returning();

  const job = jobs[0];
  if (!job) {
    throw new Error("Failed to create job");
  }

  // Create job items
  const items = packageIds.map((packageId) => ({
    jobId: job.id,
    targetId: packageId,
    status: "pending" as const,
  }));

  await deps.db.insert(schema.jobItems).values(items);

  // Enqueue
  await deps.queues.enqueue(Queues.labels, { jobId: job.id }, { jobId: `labels-${job.id}` });

  return { jobId: job.id };
}

/** Fetch each document, merge into one PDF under config.fileStorageDir, set jobs.result = { filePath }. (#33) */
export async function runLabelJob(deps: Deps, jobId: string): Promise<void> {
  // Get the job
  const jobs = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));

  if (jobs.length === 0) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const job = jobs[0]!;
  const documentType = ((job.params as unknown) as { documentType: ShippingDocumentType }).documentType;

  // Update status to running
  await deps.db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, jobId));

  // Get items
  const items = await deps.db.select().from(schema.jobItems).where(eq(schema.jobItems.jobId, jobId));

  const mergedPdf = await PDFDocument.create();
  let succeeded = 0;
  let failed = 0;
  const pages: Array<{ packageId: string }> = [];

  // Process each package
  for (const item of items) {
    try {
      const pkg = await deps.db
        .select()
        .from(schema.packages)
        .where(eq(schema.packages.id, item.targetId))
        .limit(1);

      if (pkg.length === 0) {
        await deps.db
          .update(schema.jobItems)
          .set({ status: "failed", error: "Package not found" })
          .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, item.targetId)));
        failed++;
        continue;
      }

      const packageData = pkg[0]!;

      // Check if package is shipped
      if (!packageData.trackingNumber || !packageData.shippedAt) {
        await deps.db
          .update(schema.jobItems)
          .set({ status: "failed", error: "Package not shipped" })
          .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, item.targetId)));
        failed++;
        continue;
      }

      // Check if label URL is fresh (within 24h and SHIPPING_LABEL)
      let labelUrl: string | null = null;

      if (documentType === "SHIPPING_LABEL" && packageData.labelUrl && packageData.labelFetchedAt) {
        const hoursSinceCache = (Date.now() - packageData.labelFetchedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCache < 24) {
          labelUrl = packageData.labelUrl;
        }
      }

      // Fetch label if needed
      if (!labelUrl) {
        const ctx = await getShopContext(deps, packageData.shopId);
        const fulfillmentApi = new FulfillmentApi(deps.tts);
        const doc = await fulfillmentApi.getPackageShippingDocument(ctx, item.targetId, {
          document_type: documentType,
          document_format: "PDF",
        });
        labelUrl = doc.doc_url;

        // Cache label URL
        if (documentType === "SHIPPING_LABEL") {
          await deps.db
            .update(schema.packages)
            .set({
              labelUrl,
              labelFetchedAt: new Date(),
            })
            .where(eq(schema.packages.id, item.targetId));
        }
      }

      // Download PDF
      const pdfBuffer = await fetchDocument(labelUrl);
      const pdf = await PDFDocument.load(new Uint8Array(pdfBuffer));
      const pageCount = pdf.getPageCount();

      // Embed all pages
      const pages_ = pdf.getPages();
      const embeddedPages = await mergedPdf.embedPdf(pdf);

      for (let j = 0; j < pages_.length; j++) {
        const page = pages_[j];
        if (page && embeddedPages[j]) {
          const embeddedPage = embeddedPages[j];
          const newPage = mergedPdf.addPage([embeddedPage.width, embeddedPage.height]);
          newPage.drawPage(embeddedPage);
        }
      }

      pages.push({ packageId: item.targetId });

      // Update item
      await deps.db
        .update(schema.jobItems)
        .set({
          status: "succeeded",
          response: { pages: pageCount },
        })
        .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, item.targetId)));

      succeeded++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await deps.db
        .update(schema.jobItems)
        .set({
          status: "failed",
          error: errorMessage,
        })
        .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, item.targetId)));
      failed++;
    }
  }

  // Save merged PDF
  const labelsDir = `${deps.config.fileStorageDir}/labels`;
  await mkdir(labelsDir, { recursive: true });

  const filePath = `${labelsDir}/${jobId}.pdf`;
  const pdfBytes = await mergedPdf.save();
  await writeFile(filePath, pdfBytes);

  const status = failed === 0 ? "succeeded" : failed === items.length ? "failed" : "partial";

  // Update job
  await deps.db
    .update(schema.jobs)
    .set({
      status,
      succeeded,
      failed,
      finishedAt: new Date(),
      result: { filePath, contentType: "application/pdf", pages: pages.length },
    })
    .where(eq(schema.jobs.id, jobId));
}
