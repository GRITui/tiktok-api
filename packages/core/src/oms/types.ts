/**
 * DTOs returned by the OMS HTTP API (`/v1/*`). This is the contract between apps/api and apps/web.
 * Timestamps are ISO-8601 strings; money is a decimal string.
 */

export type Role = "admin" | "ops" | "viewer";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ShopSummary {
  id: string;
  name: string;
  /** Shop market, e.g. "US", "TH", "GB". */
  region: string;
  /** Authorization entry the seller used; pass it to /auth/tiktok/connect?region= when reconnecting. */
  authRegion: "US" | "ROW";
  active: boolean;
  authorizationId: string;
  /** "active" | "expiring" (refresh token < 7 days) | "revoked" */
  authStatus: "active" | "expiring" | "revoked";
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  lastSyncedAt: string | null;
  backfillStatus: "pending" | "running" | "done" | "failed";
  /** 0..1 or null when unknown */
  backfillProgress: number | null;
  webhooksSubscribedAt: string | null;
}

export type SlaBucket = "overdue" | "lt24h" | "later";

export interface OrderListFilters {
  shopId?: string;
  status?: string;
  /** created at >= (ISO) */
  from?: string;
  /** created at < (ISO) */
  to?: string;
  sku?: string;
  /** order id or buyer user id */
  q?: string;
  sla?: SlaBucket;
  cursor?: string;
  /** default 50, max 200 */
  limit?: number;
}

export interface OrderListItem {
  id: string;
  shopId: string;
  shopName: string;
  status: string;
  currency: string;
  totalAmount: string | null;
  itemCount: number;
  createdAt: string;
  rtsSlaAt: string | null;
  shippingType: string | null;
  /** Masked unless role >= ops */
  recipientName: string | null;
}

export interface OrderLineItemView {
  id: string;
  productName: string;
  skuName: string | null;
  sellerSku: string | null;
  salePrice: string;
  displayStatus: string | null;
  packageId: string | null;
}

export interface PackageView {
  id: string;
  status: string | null;
  shippingType: string | null;
  trackingNumber: string | null;
  shippingProvider: string | null;
  handoverMethod: string | null;
  labelUrl: string | null;
  shippedAt: string | null;
  lineItemIds: string[];
  timeline: { status: string; at: string }[];
}

export interface OrderDetail extends OrderListItem {
  buyerMessage: string | null;
  /** null unless role >= ops */
  recipient: Record<string, unknown> | null;
  deliveryOptionName: string | null;
  warehouseId: string | null;
  lineItems: OrderLineItemView[];
  packages: PackageView[];
}

export interface FulfillmentQueueFilters {
  shopId?: string;
  warehouseId?: string;
  shippingType?: string;
  deliveryOptionId?: string;
  sla?: SlaBucket;
  sku?: string;
  cursor?: string;
  limit?: number;
}

export interface FulfillmentQueueItem {
  packageId: string;
  shopId: string;
  orderIds: string[];
  status: string | null;
  shippingType: string | null;
  warehouseId: string | null;
  deliveryOptionName: string | null;
  handoverMethod: string | null;
  rtsSlaAt: string | null;
  slaBucket: SlaBucket;
  itemCount: number;
  skus: string[];
}

export interface FulfillmentQueuePage extends Page<FulfillmentQueueItem> {
  counts: Record<SlaBucket, number>;
}

export interface JobView {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  total: number;
  succeeded: number;
  failed: number;
  error: string | null;
  /** Present when the job produced a file (labels PDF, CSV export) */
  downloadUrl: string | null;
  createdAt: string;
  finishedAt: string | null;
  items: { targetId: string; status: string; error: string | null }[];
}

export interface HandoverSlot {
  start: number;
  end: number;
  available: boolean;
}

export interface HandoverOptions {
  canPickup: boolean;
  canDropOff: boolean;
  pickupSlots: HandoverSlot[];
  dropOffPointUrl: string | null;
}

export interface WarehouseView {
  shopId: string;
  id: string;
  name: string;
  isDefault: boolean;
  defaultHandoverMethod: "PICKUP" | "DROP_OFF" | null;
  deliveryOptions: { id: string; name: string; providers: { id: string; name: string }[] }[];
}

export interface ShipResult {
  packageId: string;
  status: string | null;
  trackingNumber: string | null;
  /** true when this call was a replay of an earlier identical request */
  replayed: boolean;
}

/** Error body for every non-2xx /v1 response. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
