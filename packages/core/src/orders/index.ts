/**
 * Order ingestion — LANE D (Sprint 2: #19 #20 #21 #22 #23 #24 #25, plus #53 package sync inside the upsert).
 * Contract: signatures below are used by other lanes; keep them stable.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Order, WebhookEnvelope } from "@oms/tiktok-sdk";
import { EventsApi, OrdersApi, WebhookType } from "@oms/tiktok-sdk";
import type { Deps, ResolvedShop } from "../context.js";
import { OmsError } from "../errors.js";
import { Queues } from "../queues.js";
import { sha256 } from "../crypto.js";
import {
  orders,
  orderLineItems,
  packages,
  orderPackages,
  packageLineItems,
  webhookEvents,
  syncCursors,
  shops,
  schema,
} from "@oms/db";
import type { RecipientAddress } from "@oms/tiktok-sdk";
import { getShopContext, markAuthorizationRevoked } from "../auth/index.js";
import { handlePackageUpdate } from "../logistics/index.js";

export { createRedisRateLimiter, InMemoryRateLimiter } from "./rateLimiter.js";

/** Widened Order type to include optional TikTok fields (#53). */
type OrderWithDelivery = Order & {
  delivery_option_id?: string;
  warehouse_id?: string;
};

/**
 * Upsert orders, line items, packages, order_packages and package_line_items in one transaction per order.
 * Skips an order whose stored tts_updated_at is newer than the incoming update_time.
 * Sets orders.recipient_hash = sha256 of the normalized recipient address.
 */
export async function upsertOrders(
  deps: Deps,
  shopId: string,
  ordersToUpsert: OrderWithDelivery[],
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;

  for (const order of ordersToUpsert) {
    await deps.db.transaction(async (tx) => {
      const existing = await tx.query.orders.findFirst({
        where: eq(orders.id, order.id),
      });

      if (existing && existing.ttsUpdatedAt >= order.update_time) {
        skipped++;
        return;
      }

      const recipientHash = order.recipient_address
        ? sha256(JSON.stringify(normalizeRecipientAddress(order.recipient_address)))
        : null;

      await tx
        .insert(orders)
        .values({
          id: order.id,
          shopId,
          status: order.status as any,
          currency: order.payment.currency,
          totalAmount: order.payment.total_amount,
          buyerUserId: order.user_id,
          buyerMessage: order.buyer_message,
          recipient: order.recipient_address,
          recipientHash,
          fulfillmentType: order.fulfillment_type,
          shippingType: order.shipping_type,
          deliveryOptionId: order.delivery_option_id,
          deliveryOptionName: order.delivery_option_name,
          warehouseId: order.warehouse_id,
          isCod: order.is_cod,
          rtsSlaAt: order.rts_sla_time ? new Date(order.rts_sla_time * 1000) : null,
          ttsCreatedAt: new Date(order.create_time * 1000),
          ttsUpdatedAt: order.update_time,
          raw: order,
        })
        .onConflictDoUpdate({
          target: orders.id,
          set: {
            status: order.status as any,
            currency: order.payment.currency,
            totalAmount: order.payment.total_amount,
            buyerUserId: order.user_id,
            buyerMessage: order.buyer_message,
            recipient: order.recipient_address,
            recipientHash,
            fulfillmentType: order.fulfillment_type,
            shippingType: order.shipping_type,
            deliveryOptionId: order.delivery_option_id,
            deliveryOptionName: order.delivery_option_name,
            warehouseId: order.warehouse_id,
            isCod: order.is_cod,
            rtsSlaAt: order.rts_sla_time ? new Date(order.rts_sla_time * 1000) : null,
            ttsUpdatedAt: order.update_time,
            raw: order,
          },
        });

      for (const lineItem of order.line_items) {
        await tx
          .insert(orderLineItems)
          .values({
            id: lineItem.id,
            orderId: order.id,
            productId: lineItem.product_id,
            skuId: lineItem.sku_id,
            sellerSku: lineItem.seller_sku,
            productName: lineItem.product_name,
            skuName: lineItem.sku_name,
            salePrice: lineItem.sale_price,
            displayStatus: lineItem.display_status,
            packageId: lineItem.package_id,
          })
          .onConflictDoUpdate({
            target: orderLineItems.id,
            set: {
              displayStatus: lineItem.display_status,
              packageId: lineItem.package_id,
            },
          });
      }

      const packageIds = new Set<string>();
      for (const lineItem of order.line_items) {
        if (lineItem.package_id) {
          packageIds.add(lineItem.package_id);
        }
      }

      for (const packageId of packageIds) {
        await tx
          .insert(packages)
          .values({
            id: packageId,
            shopId,
            shippingType: order.shipping_type,
            deliveryOptionId: order.delivery_option_id,
            warehouseId: order.warehouse_id,
          })
          .onConflictDoUpdate({
            target: packages.id,
            set: {
              shippingType: order.shipping_type,
              deliveryOptionId: order.delivery_option_id,
              warehouseId: order.warehouse_id,
            },
          });

        await tx
          .insert(orderPackages)
          .values({
            orderId: order.id,
            packageId,
          })
          .onConflictDoNothing();

        for (const lineItem of order.line_items) {
          if (lineItem.package_id === packageId) {
            await tx
              .insert(packageLineItems)
              .values({
                packageId,
                lineItemId: lineItem.id,
              })
              .onConflictDoNothing();
          }
        }
      }

      written++;
    });
  }

  return { written, skipped };
}

function normalizeRecipientAddress(addr: RecipientAddress) {
  return {
    name: addr.name,
    phone_number: addr.phone_number,
    full_address: addr.full_address,
    postal_code: addr.postal_code,
    region_code: addr.region_code,
    district_info: addr.district_info,
  };
}

/** Fetch Get Order Detail (batched by 50) and upsert. Used after ship actions and by webhook processing. */
export async function refreshOrders(_deps: Deps, _shopId: string, _orderIds: string[]): Promise<void> {
  if (_orderIds.length === 0) return;

  const shop = await getShopContext(_deps, _shopId);
  const api = new OrdersApi(_deps.tts);
  const orders = await api.getDetails(shop, _orderIds);
  await upsertOrders(_deps, _shopId, orders);
}

/** Store a verified webhook (dedupe on tts_notification_id) and enqueue Queues.webhook. */
export async function ingestWebhook(
  deps: Deps,
  event: WebhookEnvelope,
): Promise<{ eventId: number | null; duplicate: boolean }> {
  const inserted = await deps.db
    .insert(webhookEvents)
    .values({
      notificationId: event.tts_notification_id,
      type: event.type,
      shopId: event.shop_id,
      payload: event.data,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  if (inserted.length === 0) {
    return { eventId: null, duplicate: true };
  }

  const eventId = inserted[0]!.id;
  await deps.queues.enqueue(Queues.webhook, { eventId }, { jobId: `wh-${eventId}` });

  return { eventId, duplicate: false };
}

/**
 * Process one stored webhook. Dispatch by type:
 *  ORDER_STATUS_CHANGE / RECIPIENT_ADDRESS_UPDATE → refreshOrders
 *  PACKAGE_UPDATE → logistics.handlePackageUpdate
 *  seller deauthorization → auth.markAuthorizationRevoked
 *  others → mark processed (handled in later sprints)
 * Sets processed_at, or increments attempts + error and rethrows so the queue retries.
 */
export async function processWebhookEvent(deps: Deps, eventId: number): Promise<void> {
  const row = await deps.db.query.webhookEvents.findFirst({
    where: eq(webhookEvents.id, eventId),
  });

  if (!row) {
    throw new OmsError("not_found", `webhook_events ${eventId} not found`, 404);
  }

  if (row.processedAt) {
    return;
  }

  try {
    const type = row.type as any;

    if (type === WebhookType.ORDER_STATUS_CHANGE) {
      const data = row.payload as { order_id: string };
      await refreshOrders(deps, row.shopId, [data.order_id]);
    } else if (type === WebhookType.RECIPIENT_ADDRESS_UPDATE) {
      const data = row.payload as { order_id: string };
      await refreshOrders(deps, row.shopId, [data.order_id]);
    } else if (type === WebhookType.PACKAGE_UPDATE) {
      const data = row.payload as { package_id: string };
      await handlePackageUpdate(deps, { shopId: row.shopId, packageId: data.package_id });
    } else if (type === WebhookType.SELLER_DEAUTHORIZATION) {
      const shop = await deps.db.query.shops.findFirst({
        where: eq(shops.id, row.shopId),
      });
      if (shop) {
        await markAuthorizationRevoked(deps, shop.authorizationId, "webhook");
      }
    }

    await deps.db
      .update(webhookEvents)
      .set({ processedAt: deps.now(), error: null })
      .where(eq(webhookEvents.id, eventId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.db
      .update(webhookEvents)
      .set({
        attempts: sql`${webhookEvents.attempts} + 1`,
        error: message,
      })
      .where(eq(webhookEvents.id, eventId));
    throw err;
  }
}

/** Idempotently subscribe the shop to the webhook event types the OMS needs (Events API). */
export async function ensureWebhookSubscriptions(deps: Deps, shopId: string): Promise<void> {
  const webhookUrl = process.env.WEBHOOK_PUBLIC_URL;
  if (!webhookUrl) {
    return;
  }

  const shop = await getShopContext(deps, shopId);
  const api = new EventsApi(deps.tts);

  const eventTypes = [
    "ORDER_STATUS_CHANGE",
    "RECIPIENT_ADDRESS_UPDATE",
    "PACKAGE_UPDATE",
    "CANCELLATION_STATUS_CHANGE",
    "RETURN_STATUS_CHANGE",
  ];

  const existing = await api.getShopWebhooks(shop);
  const existingMap = new Map(existing.map((w) => [w.event_type, w]));

  for (const eventType of eventTypes) {
    const current = existingMap.get(eventType);
    if (!current || current.address !== webhookUrl) {
      await api.updateShopWebhook(shop, { event_type: eventType, address: webhookUrl });
    }
  }

  await deps.db
    .update(shops)
    .set({ webhooksSubscribedAt: deps.now() })
    .where(eq(shops.id, shopId));
}

/** Incremental poll from sync_cursors(shop,"orders") minus overlap; advances the cursor after each committed page. */
export async function runOrderSync(deps: Deps, shopId: string): Promise<{ orders: number }> {
  let shop: any;
  try {
    shop = await getShopContext(deps, shopId);
  } catch (err) {
    if (err instanceof OmsError && err.code === "shop_revoked") {
      return { orders: 0 };
    }
    throw err;
  }

  const cursor = await deps.db.query.syncCursors.findFirst({
    where: and(eq(syncCursors.shopId, shopId), eq(syncCursors.stream, "orders")),
  });

  const overlapMs = deps.config.pollOverlapMinutes * 60 * 1000;
  const startTime = cursor?.updateTimeGe ?? Math.floor((deps.now().getTime() - 24 * 60 * 60 * 1000) / 1000);
  const updateTimeGe = startTime - Math.floor(overlapMs / 1000);

  const api = new OrdersApi(deps.tts);
  let totalOrders = 0;
  let maxUpdateTime = 0;
  let foundOrders = false;

  for await (const order of api.searchAll(
    shop,
    { page_size: 50, sort_field: "update_time", sort_order: "ASC" },
    { update_time_ge: updateTimeGe },
  )) {
    const result = await upsertOrders(deps, shopId, [order]);
    totalOrders += result.written + result.skipped;
    maxUpdateTime = Math.max(maxUpdateTime, order.update_time);
    foundOrders = true;
  }

  if (foundOrders) {
    await deps.db
      .insert(syncCursors)
      .values({
        shopId,
        stream: "orders",
        updateTimeGe: maxUpdateTime,
        lastRunAt: deps.now(),
        lastError: null,
      })
      .onConflictDoUpdate({
        target: [syncCursors.shopId, syncCursors.stream],
        set: {
          updateTimeGe: maxUpdateTime,
          lastRunAt: deps.now(),
          lastError: null,
        },
      });
  }

  return { orders: totalOrders };
}

/** Resumable historical import in time windows; updates shops.backfill_* fields. Calls ensureWebhookSubscriptions first. */
export async function runBackfill(deps: Deps, shopId: string): Promise<void> {
  await ensureWebhookSubscriptions(deps, shopId);

  const shop = await deps.db.query.shops.findFirst({
    where: eq(shops.id, shopId),
  });

  if (!shop) {
    throw new OmsError("not_found", `shop ${shopId} not found`, 404);
  }

  const backfillFrom = shop.backfillFrom ?? Math.floor((deps.now().getTime() - deps.config.backfillDays * 24 * 60 * 60 * 1000) / 1000);
  const backfillCursor = shop.backfillCursor ?? backfillFrom;
  const now = Math.floor(deps.now().getTime() / 1000);

  await deps.db
    .update(shops)
    .set({
      backfillStatus: "running",
      backfillFrom,
    })
    .where(eq(shops.id, shopId));

  try {
    const shopCtx = await getShopContext(deps, shopId);
    const api = new OrdersApi(deps.tts);

    let windowStart = backfillCursor;
    const windowSize = 24 * 60 * 60;

    while (windowStart < now) {
      const windowEnd = Math.min(windowStart + windowSize, now);

      for await (const order of api.searchAll(
        shopCtx,
        { page_size: 50, sort_field: "create_time", sort_order: "ASC" },
        { create_time_ge: windowStart, create_time_lt: windowEnd },
      )) {
        await upsertOrders(deps, shopId, [order]);
      }

      windowStart = windowEnd;

      await deps.db
        .update(shops)
        .set({ backfillCursor: windowStart })
        .where(eq(shops.id, shopId));
    }

    const existingCursor = await deps.db.query.syncCursors.findFirst({
      where: and(eq(syncCursors.shopId, shopId), eq(syncCursors.stream, "orders")),
    });

    if (!existingCursor) {
      await deps.db
        .insert(syncCursors)
        .values({
          shopId,
          stream: "orders",
          updateTimeGe: now,
        })
        .onConflictDoNothing();
    }

    await deps.db
      .update(shops)
      .set({ backfillStatus: "done" })
      .where(eq(shops.id, shopId));
  } catch (err) {
    await deps.db
      .update(shops)
      .set({ backfillStatus: "failed" })
      .where(eq(shops.id, shopId));
    throw err;
  }
}
