import {
  bigint, boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const orderStatus = pgEnum("order_status", [
  "UNPAID", "ON_HOLD", "AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION",
  "IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELLED",
]);

/** A TikTok Shop authorized to this app. One seller authorization can grant several shops. */
export const shops = pgTable("shops", {
  id: text("id").primaryKey(), // TikTok shop_id
  name: text("name").notNull(),
  region: text("region").notNull(),
  cipher: text("cipher").notNull(),
  sellerType: text("seller_type"),
  authorizationId: text("authorization_id").notNull().references(() => authorizations.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tokens per seller authorization (open_id). Token values are stored encrypted. */
export const authorizations = pgTable("authorizations", {
  id: text("id").primaryKey(), // open_id
  sellerName: text("seller_name").notNull(),
  sellerBaseRegion: text("seller_base_region").notNull(),
  userType: integer("user_type").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }).notNull(),
  grantedScopes: jsonb("granted_scopes").$type<string[]>(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: text("id").primaryKey(), // TikTok order id
  shopId: text("shop_id").notNull().references(() => shops.id),
  status: orderStatus("status").notNull(),
  currency: text("currency").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }),
  buyerUserId: text("buyer_user_id"),
  recipient: jsonb("recipient"),
  fulfillmentType: text("fulfillment_type"),
  shippingType: text("shipping_type"),
  isCod: boolean("is_cod").default(false),
  rtsSlaAt: timestamp("rts_sla_at", { withTimezone: true }),
  ttsCreatedAt: timestamp("tts_created_at", { withTimezone: true }).notNull(),
  /** TikTok `update_time`; used to ignore out-of-order webhook/poll writes. */
  ttsUpdatedAt: bigint("tts_updated_at", { mode: "number" }).notNull(),
  raw: jsonb("raw").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("orders_shop_status_idx").on(t.shopId, t.status),
  index("orders_shop_created_idx").on(t.shopId, t.ttsCreatedAt),
]);

export const orderLineItems = pgTable("order_line_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  skuId: text("sku_id").notNull(),
  sellerSku: text("seller_sku"),
  productName: text("product_name").notNull(),
  salePrice: numeric("sale_price", { precision: 14, scale: 2 }).notNull(),
  displayStatus: text("display_status"),
  packageId: text("package_id"),
}, (t) => [index("line_items_order_idx").on(t.orderId), index("line_items_sku_idx").on(t.sellerSku)]);

export const packages = pgTable("packages", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull().references(() => shops.id),
  status: text("status"),
  trackingNumber: text("tracking_number"),
  shippingProvider: text("shipping_provider"),
  labelUrl: text("label_url"),
  raw: jsonb("raw"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderPackages = pgTable("order_packages", {
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  packageId: text("package_id").notNull().references(() => packages.id),
}, (t) => [primaryKey({ columns: [t.orderId, t.packageId] })]);

/** Raw inbound webhooks; `tts_notification_id` makes delivery idempotent. */
export const webhookEvents = pgTable("webhook_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  notificationId: text("notification_id").notNull(),
  type: integer("type").notNull(),
  shopId: text("shop_id").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
}, (t) => [uniqueIndex("webhook_events_notification_uq").on(t.notificationId)]);

/** High-water mark per shop/stream for incremental polling (backstop to webhooks). */
export const syncCursors = pgTable("sync_cursors", {
  shopId: text("shop_id").notNull().references(() => shops.id),
  stream: text("stream").notNull(), // e.g. "orders", "cancellations", "returns"
  updateTimeGe: bigint("update_time_ge", { mode: "number" }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.shopId, t.stream] })]);

/** Audit trail for every write action the OMS performs against TikTok. */
export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actor: text("actor").notNull(),
  shopId: text("shop_id"),
  action: text("action").notNull(),
  targetId: text("target_id"),
  request: jsonb("request"),
  response: jsonb("response"),
  ok: boolean("ok").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
