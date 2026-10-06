import type { TikTokClient } from "../client.js";
import { API_VERSIONS } from "../versions.js";
import type { ShopContext } from "./orders.js";

const V = API_VERSIONS.fulfillment;

/*
 * Fulfillment API (202309). Paths and field names follow the 202309 reference as best known at scaffold
 * time — LANE F1 (#52) must verify each against the reference page and adjust types (add fields freely;
 * keep method names and parameter order stable, other lanes call them).
 */

export type HandoverMethod = "PICKUP" | "DROP_OFF";

/** Normalize the avaliable/available typo from the API response. */
export function slotAvailable(slot: TimeSlot & { avaliable?: boolean; available?: boolean }): boolean {
  return slot.available ?? slot.avaliable ?? false;
}

export interface TimeSlot {
  start_time: number;
  end_time: number;
}

export interface PackageDetail {
  package_id: string;
  package_status: string;
  shipping_type?: string;
  handover_method?: HandoverMethod;
  pickup_slot?: TimeSlot;
  tracking_number?: string;
  shipping_provider_id?: string;
  shipping_provider_name?: string;
  delivery_option_id?: string;
  delivery_option_name?: string;
  warehouse_id?: string;
  orders?: { id: string; skus?: { id: string; quantity?: number }[] }[];
  update_time?: number;
  create_time?: number;
}

export interface HandoverTimeSlots {
  can_pickup?: boolean;
  can_drop_off?: boolean;
  pickup_slots?: (TimeSlot & { avaliable?: boolean; available?: boolean })[];
  drop_off_point_url?: string;
}

export interface SelfShipment {
  tracking_number: string;
  shipping_provider_id: string;
}

export interface ShipPackageBody {
  handover_method?: HandoverMethod;
  pickup_slot?: TimeSlot;
  self_shipment?: SelfShipment;
}

export interface BatchShipError {
  code: number;
  message: string;
  detail?: { package_id?: string };
}

export type DocumentType = "SHIPPING_LABEL" | "PACKING_SLIP" | "SHIPPING_LABEL_AND_PACKING_SLIP";

export class FulfillmentApi {
  constructor(private readonly client: TikTokClient) {}

  getPackageDetail(ctx: ShopContext, packageId: string): Promise<PackageDetail> {
    return this.client.request({ method: "GET", path: `/fulfillment/${V}/packages/${packageId}`, ...ctx });
  }

  searchPackages(
    ctx: ShopContext,
    query: { page_size: number; page_token?: string; sort_field?: string; sort_order?: "ASC" | "DESC" },
    body: { package_status?: string; create_time_ge?: number; create_time_lt?: number; update_time_ge?: number; update_time_lt?: number } = {},
  ): Promise<{ packages?: PackageDetail[]; next_page_token?: string; total_count?: number }> {
    return this.client.request({ method: "POST", path: `/fulfillment/${V}/packages/search`, query: { ...query }, body, ...ctx });
  }

  getHandoverTimeSlots(ctx: ShopContext, packageId: string): Promise<HandoverTimeSlots> {
    return this.client.request({ method: "GET", path: `/fulfillment/${V}/packages/${packageId}/handover_time_slots`, ...ctx });
  }

  /** TikTok Shipping: handover_method (+ pickup_slot). Seller shipping: self_shipment. */
  shipPackage(ctx: ShopContext, packageId: string, body: ShipPackageBody): Promise<void> {
    return this.client.request({ method: "POST", path: `/fulfillment/${V}/packages/${packageId}/ship`, body, ...ctx });
  }

  /** Partial success: failures are returned in `errors`, not thrown. */
  batchShipPackages(
    ctx: ShopContext,
    body: { packages: ({ id: string } & ShipPackageBody)[] },
  ): Promise<{ errors?: BatchShipError[] }> {
    return this.client.request({ method: "POST", path: `/fulfillment/${V}/packages/ship`, body, ...ctx });
  }

  getPackageShippingDocument(
    ctx: ShopContext,
    packageId: string,
    query: { document_type: DocumentType; document_size?: "A6" | "A5"; document_format?: "PDF" },
  ): Promise<{ doc_url: string; tracking_number?: string }> {
    return this.client.request({
      method: "GET",
      path: `/fulfillment/${V}/packages/${packageId}/shipping_documents`,
      query: { ...query },
      ...ctx,
    });
  }

  /** Seller shipping: change tracking / provider after shipping. */
  updatePackageShippingInfo(ctx: ShopContext, packageId: string, body: SelfShipment): Promise<void> {
    return this.client.request({ method: "POST", path: `/fulfillment/${V}/packages/${packageId}/shipping_info/update`, body, ...ctx });
  }

  getOrderSplitAttributes(ctx: ShopContext, orderIds: string[]) {
    return this.client.request<{ split_attributes?: unknown[] }>({
      method: "GET",
      path: `/fulfillment/${V}/orders/split_attributes`,
      query: { order_ids: orderIds.join(",") },
      ...ctx,
    });
  }

  splitOrders(ctx: ShopContext, orderId: string, body: { splittable_groups: { id: string; order_line_item_ids: string[] }[] }) {
    return this.client.request<unknown>({ method: "POST", path: `/fulfillment/${V}/orders/${orderId}/split`, body, ...ctx });
  }

  searchCombinablePackages(ctx: ShopContext, query: { page_size: number; page_token?: string }) {
    return this.client.request<{ combinable_packages?: { id: string; order_ids: string[] }[]; next_page_token?: string }>({
      method: "GET",
      path: `/fulfillment/${V}/combinable_packages/search`,
      query: { ...query },
      ...ctx,
    });
  }

  combinePackage(ctx: ShopContext, body: { combinable_packages: { id: string; order_ids: string[] }[] }) {
    return this.client.request<unknown>({ method: "POST", path: `/fulfillment/${V}/packages/combine`, body, ...ctx });
  }

  uncombinePackages(ctx: ShopContext, packageId: string, body: { order_ids: string[] }) {
    return this.client.request<unknown>({ method: "POST", path: `/fulfillment/${V}/packages/${packageId}/uncombine`, body, ...ctx });
  }
}
