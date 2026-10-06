import type { OrdersApi, ShopContext } from "@oms/tiktok-sdk";

export interface OrderSyncJob {
  shopId: string;
}

/**
 * Incremental order sync for one shop.
 * TODO(Sprint 2):
 *  - load shop cipher + decrypted token
 *  - read sync_cursors(shop, "orders").update_time_ge (minus overlap window)
 *  - OrdersApi.searchAll with update_time_ge, sort update_time ASC
 *  - upsert orders/line items, skipping rows whose stored tts_updated_at is newer
 *  - advance cursor
 */
export async function runOrderSync(_api: OrdersApi, _ctx: ShopContext, job: OrderSyncJob): Promise<void> {
  throw new Error(`orderSync not implemented (shop ${job.shopId})`);
}
