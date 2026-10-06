import {
  bigint, boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const orderStatus = pgEnum("order_status", [
  "UNPAID", "ON_HOLD", "AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION",
  "IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELLED",
]);

export const userRole = pgEnum("user_role", ["admin", "ops", "viewer"]);

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ─── Seller authorization ──────────────────────────────────────────────────

/** Tokens per seller authorization (open_id). Token values are stored encrypted (see @oms/core crypto). */
export const authorizations = pgTable("authorizations", {
  id: text("id").primaryKey(), // open_id
  sellerName: text("seller_name").notNull(),
  sellerBaseRegion: text("seller_base_region").notNull(),
  /** Authorization entry used: "US" or "ROW". */
  region: text("region").notNull().default("ROW"),
  userType: integer("user_type").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  accessTokenExpiresAt: ts("access_token_expires_at").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  refreshTokenExpiresAt: ts("refresh_token_expires_at").notNull(),
  grantedScopes: jsonb("granted_scopes").$type<string[]>(),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** CSRF state for the seller authorize redirect. Single use, short TTL. */
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  region: text("region").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

/** A TikTok Shop authorized to this app. One seller authorization can grant several shops. */
export const shops = pgTable("shops", {
  id: text("id").primaryKey(), // TikTok shop_id
  name: text("name").notNull(),
  region: text("region").notNull(),
  cipher: text("cipher").notNull(),
  code: text("code"),
  sellerType: text("seller_type"),
  authorizationId: text("authorization_id").notNull().references(() => authorizations.id),
  active: boolean("active").notNull().default(true),
  /** Backfill progress: "pending" | "running" | "done" | "failed". */
  backfillStatus: text("backfill_status").notNull().default("pending"),
  /** create_time (unix s) the backfill has reached; resumes from here. */
  backfillCursor: bigint("backfill_cursor", { mode: "number" }),
  backfillFrom: bigint("backfill_from", { mode: "number" }),
  webhooksSubscribedAt: ts("webhooks_subscribed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ─── Orders ────────────────────────────────────────────────────────────────

export const orders = pgTable("orders", {
  id: text("id").primaryKey(), // TikTok order id
  shopId: text("shop_id").notNull().references(() => shops.id),
  status: orderStatus("status").notNull(),
  currency: text("currency").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }),
  buyerUserId: text("buyer_user_id"),
  buyerMessage: text("buyer_message"),
  recipient: jsonb("recipient"),
  /** sha256 of the normalized recipient address; used to detect address changes before shipping. */
  recipientHash: text("recipient_hash"),
  fulfillmentType: text("fulfillment_type"),
  shippingType: text("shipping_type"),
  deliveryOptionId: text("delivery_option_id"),
  deliveryOptionName: text("delivery_option_name"),
  warehouseId: text("warehouse_id"),
  isCod: boolean("is_cod").default(false),
  rtsSlaAt: ts("rts_sla_at"),
  ttsCreatedAt: ts("tts_created_at").notNull(),
  /** TikTok `update_time` (unix s); used to ignore out-of-order webhook/poll writes. */
  ttsUpdatedAt: bigint("tts_updated_at", { mode: "number" }).notNull(),
  raw: jsonb("raw").notNull(),
  syncedAt: ts("synced_at").notNull().defaultNow(),
}, (t) => [
  index("orders_shop_status_idx").on(t.shopId, t.status),
  index("orders_shop_created_idx").on(t.shopId, t.ttsCreatedAt),
  index("orders_status_sla_idx").on(t.status, t.rtsSlaAt),
]);

export const orderLineItems = pgTable("order_line_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  skuId: text("sku_id").notNull(),
  sellerSku: text("seller_sku"),
  productName: text("product_name").notNull(),
  skuName: text("sku_name"),
  salePrice: numeric("sale_price", { precision: 14, scale: 2 }).notNull(),
  displayStatus: text("display_status"),
  packageId: text("package_id"),
}, (t) => [index("line_items_order_idx").on(t.orderId), index("line_items_sku_idx").on(t.sellerSku)]);

// ─── Packages / fulfillment ────────────────────────────────────────────────

export const packages = pgTable("packages", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull().references(() => shops.id),
  status: text("status"),
  /** "TIKTOK" (platform logistics) or "SELLER" (own carrier). */
  shippingType: text("shipping_type"),
  deliveryOptionId: text("delivery_option_id"),
  warehouseId: text("warehouse_id"),
  /** "PICKUP" | "DROP_OFF" */
  handoverMethod: text("handover_method"),
  pickupSlotStart: bigint("pickup_slot_start", { mode: "number" }),
  pickupSlotEnd: bigint("pickup_slot_end", { mode: "number" }),
  trackingNumber: text("tracking_number"),
  shippingProviderId: text("shipping_provider_id"),
  shippingProvider: text("shipping_provider"),
  labelUrl: text("label_url"),
  labelFetchedAt: ts("label_fetched_at"),
  /** recipientHash of the order when the package was shipped/labelled. */
  shippedRecipientHash: text("shipped_recipient_hash"),
  shippedAt: ts("shipped_at"),
  ttsUpdatedAt: bigint("tts_updated_at", { mode: "number" }),
  raw: jsonb("raw"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("packages_shop_status_idx").on(t.shopId, t.status)]);

export const orderPackages = pgTable("order_packages", {
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  packageId: text("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.orderId, t.packageId] }), index("order_packages_pkg_idx").on(t.packageId)]);

export const packageLineItems = pgTable("package_line_items", {
  packageId: text("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
  lineItemId: text("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.packageId, t.lineItemId] })]);

/** Package status history for the order detail timeline. */
export const packageEvents = pgTable("package_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  packageId: text("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  ttsUpdatedAt: bigint("tts_updated_at", { mode: "number" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("package_events_pkg_idx").on(t.packageId)]);

// ─── Logistics reference data (Logistics API) ──────────────────────────────

export const warehouses = pgTable("warehouses", {
  shopId: text("shop_id").notNull().references(() => shops.id),
  id: text("id").notNull(),
  name: text("name").notNull(),
  type: text("type"),
  isDefault: boolean("is_default").notNull().default(false),
  /** "PICKUP" | "DROP_OFF"; default handover for TikTok Shipping packages from this warehouse. */
  defaultHandoverMethod: text("default_handover_method"),
  address: jsonb("address"),
  raw: jsonb("raw"),
  syncedAt: ts("synced_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.shopId, t.id] })]);

export const deliveryOptions = pgTable("delivery_options", {
  shopId: text("shop_id").notNull().references(() => shops.id),
  warehouseId: text("warehouse_id").notNull(),
  id: text("id").notNull(),
  name: text("name").notNull(),
  type: text("type"),
  raw: jsonb("raw"),
  syncedAt: ts("synced_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.shopId, t.warehouseId, t.id] })]);

export const shippingProviders = pgTable("shipping_providers", {
  shopId: text("shop_id").notNull().references(() => shops.id),
  deliveryOptionId: text("delivery_option_id").notNull(),
  id: text("id").notNull(),
  name: text("name").notNull(),
  raw: jsonb("raw"),
  syncedAt: ts("synced_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.shopId, t.deliveryOptionId, t.id] })]);

// ─── Webhooks & sync ───────────────────────────────────────────────────────

/** Raw inbound webhooks; `tts_notification_id` makes delivery idempotent. */
export const webhookEvents = pgTable("webhook_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  notificationId: text("notification_id").notNull(),
  type: integer("type").notNull(),
  shopId: text("shop_id").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
}, (t) => [uniqueIndex("webhook_events_notification_uq").on(t.notificationId)]);

/** High-water mark per shop/stream for incremental polling (backstop to webhooks). */
export const syncCursors = pgTable("sync_cursors", {
  shopId: text("shop_id").notNull().references(() => shops.id),
  stream: text("stream").notNull(), // e.g. "orders"
  updateTimeGe: bigint("update_time_ge", { mode: "number" }).notNull(),
  lastRunAt: ts("last_run_at"),
  lastError: text("last_error"),
}, (t) => [primaryKey({ columns: [t.shopId, t.stream] })]);

// ─── OMS users ─────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  role: userRole("role").notNull().default("viewer"),
  passwordHash: text("password_hash").notNull(),
  disabledAt: ts("disabled_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const sessions = pgTable("sessions", {
  /** sha256 of the session token; the raw token only lives in the cookie. */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ─── Background jobs, idempotency, audit ───────────────────────────────────

/** User-visible background jobs (batch ship, label PDF, export, backfill). */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** "batch_ship" | "labels" | "order_export" */
  type: text("type").notNull(),
  /** "queued" | "running" | "succeeded" | "partial" | "failed" */
  status: text("status").notNull().default("queued"),
  shopId: text("shop_id"),
  params: jsonb("params"),
  total: integer("total").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  /** Output, e.g. { filePath } for labels/exports. */
  result: jsonb("result"),
  error: text("error"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const jobItems = pgTable("job_items", {
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  targetId: text("target_id").notNull(),
  /** "pending" | "succeeded" | "failed" | "skipped" */
  status: text("status").notNull().default("pending"),
  error: text("error"),
  response: jsonb("response"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.jobId, t.targetId] })]);

/** Guards fulfillment writes against double submission. */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  /** "in_progress" | "succeeded" | "failed" */
  status: text("status").notNull(),
  response: jsonb("response"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Audit trail for every write action the OMS performs against TikTok. */
export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actor: text("actor").notNull(),
  shopId: text("shop_id"),
  action: text("action").notNull(),
  targetId: text("target_id"),
  request: jsonb("request"),
  response: jsonb("response"),
  ttsRequestId: text("tts_request_id"),
  ok: boolean("ok").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("audit_log_target_idx").on(t.targetId)]);
