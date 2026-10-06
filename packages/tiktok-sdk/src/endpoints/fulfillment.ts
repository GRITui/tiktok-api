import type { TikTokClient } from "../client.js";
import { API_VERSIONS } from "../versions.js";
import type { ShopContext } from "./orders.js";

const V = API_VERSIONS.fulfillment;

/**
 * Fulfillment operations. Request/response shapes are intentionally loose until
 * each endpoint is implemented and verified against the reference docs (see roadmap Sprint 3).
 */
export class FulfillmentApi {
  constructor(private readonly client: TikTokClient) {}

  getOrderSplitAttributes(ctx: ShopContext, orderIds: string[]) {
    return this.client.request<unknown>({
      method: "GET",
      path: `/fulfillment/${V}/orders/split_attributes`,
      query: { order_ids: orderIds.join(",") },
      ...ctx,
    });
  }

  /** Ship a package with TikTok-provided label (4PL) or seller logistics (3PL). */
  shipPackage(ctx: ShopContext, packageId: string, body: Record<string, unknown>) {
    return this.client.request<unknown>({
      method: "POST",
      path: `/fulfillment/${V}/packages/${packageId}/ship`,
      body,
      ...ctx,
    });
  }

  getPackageShippingDocument(ctx: ShopContext, packageId: string, documentType: string) {
    return this.client.request<{ doc_url?: string; tracking_number?: string }>({
      method: "GET",
      path: `/fulfillment/${V}/packages/${packageId}/shipping_documents`,
      query: { document_type: documentType },
      ...ctx,
    });
  }

  /** Update tracking for seller-shipped (3PL) packages. */
  updateShippingInfo(ctx: ShopContext, orderId: string, body: { tracking_number: string; shipping_provider_id: string }) {
    return this.client.request<unknown>({
      method: "POST",
      path: `/fulfillment/${V}/orders/${orderId}/shipping_info/update`,
      body,
      ...ctx,
    });
  }
}
