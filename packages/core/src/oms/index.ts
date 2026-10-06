/**
 * OMS users, order queries, export, jobs — LANE E1 (Sprint 3: #26 #27 #30, Sprint 4: #55).
 * Contract: signatures below are used by apps/api; keep them stable.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, asc, desc, eq, exists, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import type { Deps } from "../context.js";
import { OmsError } from "../errors.js";
import { Queues } from "../queues.js";
import { schema } from "@oms/db";
import type {
  FulfillmentQueueFilters, FulfillmentQueuePage, FulfillmentQueueItem, JobView, OrderDetail, OrderListFilters, OrderListItem,
  Page, Role, SessionUser, SlaBucket,
} from "./types.js";

export * from "./types.js";

const RANK: Record<Role, number> = { viewer: 0, ops: 1, admin: 2 };
export const hasRole = (user: Pick<SessionUser, "role">, required: Role) => RANK[user.role] >= RANK[required];

const scryptAsync = promisify(scrypt);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** scrypt password hash; email lower-cased; throws OmsError("email_taken", 409). */
export async function createUser(
  deps: Deps,
  input: { email: string; password: string; role: Role; name?: string },
): Promise<SessionUser> {
  const email = input.email.toLowerCase();
  const existing = await deps.db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (existing) throw new OmsError("email_taken", "Email already registered", 409);

  const salt = randomBytes(16);
  const hash = (await scryptAsync(input.password, salt, 32)) as Buffer;
  const passwordHash = `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;

  const users = await deps.db
    .insert(schema.users)
    .values({
      email,
      name: input.name || null,
      role: input.role,
      passwordHash,
    })
    .returning();

  const user = users[0];
  if (!user) throw new Error("Failed to create user");
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  const [algo, salt64, hash64] = passwordHash.split("$");
  if (algo !== "scrypt" || !salt64 || !hash64) throw new Error("Invalid password hash format");
  const salt = Buffer.from(salt64, "base64");
  const storedHash = Buffer.from(hash64, "base64");
  const computedHash = (await scryptAsync(password, salt, 32)) as Buffer;
  return timingSafeEqual(storedHash, computedHash);
}

/** Throws OmsError("invalid_credentials", 401). Session TTL 12h; stores sha256(token) only. */
export async function login(
  deps: Deps,
  input: { email: string; password: string },
): Promise<{ token: string; user: SessionUser; expiresAt: Date }> {
  const user = await deps.db.query.users.findFirst({
    where: eq(schema.users.email, input.email.toLowerCase()),
  });
  if (!user || user.disabledAt) throw new OmsError("invalid_credentials", "Invalid email or password", 401);

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new OmsError("invalid_credentials", "Invalid email or password", 401);
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(deps.now().getTime() + 12 * 60 * 60 * 1000);
  await deps.db.insert(schema.sessions).values({
    id: sha256(token),
    userId: user.id,
    expiresAt,
  });

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expiresAt,
  };
}

export async function getSessionUser(deps: Deps, token: string): Promise<SessionUser | null> {
  const session = await deps.db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sha256(token)),
      gt(schema.sessions.expiresAt, deps.now()),
    ),
  });

  if (!session) return null;

  const user = await deps.db.query.users.findFirst({
    where: eq(schema.users.id, session.userId),
  });

  if (!user || user.disabledAt) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function logout(deps: Deps, token: string): Promise<void> {
  await deps.db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
}

function getSlaBucket(rtsSlaAt: Date | null, now: Date): SlaBucket {
  if (!rtsSlaAt) return "later";
  const diffMs = rtsSlaAt.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  if (diffMs < 24 * 60 * 60 * 1000) return "lt24h";
  return "later";
}

function maskPii(value: string | null, hasAccessToOps: boolean): string | null {
  if (!value || hasAccessToOps) return value;
  if (value.length <= 3) return value;
  return value[0] + "*".repeat(value.length - 2) + value[value.length - 1];
}

/** Keyset pagination on (tts_created_at desc, id desc). PII masked for viewers. */
export async function listOrders(
  deps: Deps,
  filters: OrderListFilters,
  user: SessionUser,
): Promise<Page<OrderListItem>> {
  const limit = Math.min(filters.limit ?? 50, 200);
  const hasOpsAccess = hasRole(user, "ops");

  // Parse cursor
  let cursorCreatedAt: Date | undefined;
  let cursorId: string | undefined;
  if (filters.cursor) {
    const [createdAt, id] = Buffer.from(filters.cursor, "base64url").toString().split("|");
    if (createdAt && id) {
      cursorCreatedAt = new Date(createdAt);
      cursorId = id;
    }
  }

  // Build query
  const conditions: any[] = [];

  if (filters.shopId) conditions.push(eq(schema.orders.shopId, filters.shopId));
  if (filters.status) conditions.push(sql`${schema.orders.status} = ${filters.status}`);
  if (filters.from) conditions.push(gte(schema.orders.ttsCreatedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lt(schema.orders.ttsCreatedAt, new Date(filters.to)));

  if (filters.sku) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM order_line_items WHERE order_id = ${schema.orders.id} AND (seller_sku = ${filters.sku} OR sku_id = ${filters.sku}))`
    );
  }

  if (filters.q) {
    conditions.push(
      or(eq(schema.orders.id, filters.q), eq(schema.orders.buyerUserId, filters.q)),
    );
  }

  if (filters.sla) {
    const now = deps.now();
    if (filters.sla === "overdue") {
      conditions.push(lt(schema.orders.rtsSlaAt, now));
    } else if (filters.sla === "lt24h") {
      conditions.push(and(
        gte(schema.orders.rtsSlaAt, now),
        lt(schema.orders.rtsSlaAt, new Date(now.getTime() + 24 * 60 * 60 * 1000)),
      ));
    } else if (filters.sla === "later") {
      conditions.push(gte(schema.orders.rtsSlaAt, new Date(now.getTime() + 24 * 60 * 60 * 1000)));
    }
  }

  // Keyset pagination condition
  if (cursorCreatedAt && cursorId) {
    conditions.push(
      or(
        lt(schema.orders.ttsCreatedAt, cursorCreatedAt),
        and(eq(schema.orders.ttsCreatedAt, cursorCreatedAt), lt(schema.orders.id, cursorId)),
      ),
    );
  }

  const orders = await deps.db
    .select()
    .from(schema.orders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.orders.ttsCreatedAt), desc(schema.orders.id))
    .limit(limit + 1)
    .leftJoin(schema.shops, eq(schema.orders.shopId, schema.shops.id));

  const hasMore = orders.length > limit;
  const pageOrders = orders.slice(0, limit);
  const pageIds = pageOrders.map(({ orders: o }) => o.id);
  const itemCounts = new Map<string, number>();
  if (pageIds.length) {
    const counted = await deps.db
      .select({ orderId: schema.orderLineItems.orderId, n: sql<number>`count(*)::int` })
      .from(schema.orderLineItems)
      .where(inArray(schema.orderLineItems.orderId, pageIds))
      .groupBy(schema.orderLineItems.orderId);
    for (const c of counted) itemCounts.set(c.orderId, Number(c.n));
  }
  const items = pageOrders.map(({ orders: o, shops: s }) => {
    const recipient = o.recipient as any;
    return {
      id: o.id,
      shopId: o.shopId,
      shopName: s?.name || "",
      status: o.status,
      currency: o.currency,
      totalAmount: o.totalAmount?.toString() || null,
      itemCount: itemCounts.get(o.id) ?? 0,
      createdAt: o.ttsCreatedAt.toISOString(),
      rtsSlaAt: o.rtsSlaAt?.toISOString() || null,
      shippingType: o.shippingType,
      recipientName: maskPii(recipient?.name, hasOpsAccess),
    } as OrderListItem;
  });

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = orders[limit]!.orders;
    nextCursor = Buffer.from(`${last.ttsCreatedAt.toISOString()}|${last.id}`).toString("base64url");
  }

  return { items, nextCursor };
}

export async function getOrderDetail(deps: Deps, orderId: string, user: SessionUser): Promise<OrderDetail | null> {
  const order = await deps.db.query.orders.findFirst({
    where: eq(schema.orders.id, orderId),
  });

  if (!order) return null;

  // Get shop name
  const shop = await deps.db.query.shops.findFirst({
    where: eq(schema.shops.id, order.shopId),
  });
  const shopName = shop?.name || "";

  const hasOpsAccess = hasRole(user, "ops");

  // Get line items
  const lineItems = await deps.db
    .select()
    .from(schema.orderLineItems)
    .where(eq(schema.orderLineItems.orderId, orderId));

  // Get packages and timeline
  const packageRows = await deps.db
    .select()
    .from(schema.packages)
    .where(
      sql`EXISTS (SELECT 1 FROM order_packages WHERE order_id = ${orderId} AND package_id = ${schema.packages.id})`
    );

  const timeline = await deps.db
    .select()
    .from(schema.packageEvents)
    .where(
      inArray(
        schema.packageEvents.packageId,
        packageRows.map((p) => p.id),
      ),
    )
    .orderBy(asc(schema.packageEvents.createdAt));

  const eventsByPackage = new Map<string, typeof timeline>();
  for (const event of timeline) {
    const events = eventsByPackage.get(event.packageId) || [];
    events.push(event);
    eventsByPackage.set(event.packageId, events);
  }

  // Get line item to package mappings
  const lineItemsInPackages = await deps.db
    .select()
    .from(schema.packageLineItems)
    .where(
      inArray(
        schema.packageLineItems.packageId,
        packageRows.map((p) => p.id),
      ),
    );

  const lineItemsByPackage = new Map<string, string[]>();
  for (const mapping of lineItemsInPackages) {
    const ids = lineItemsByPackage.get(mapping.packageId) || [];
    ids.push(mapping.lineItemId);
    lineItemsByPackage.set(mapping.packageId, ids);
  }

  const packages = packageRows.map((p) => ({
    id: p.id,
    status: p.status,
    shippingType: p.shippingType,
    trackingNumber: p.trackingNumber,
    shippingProvider: p.shippingProvider,
    handoverMethod: p.handoverMethod,
    labelUrl: p.labelUrl,
    shippedAt: p.shippedAt?.toISOString() || null,
    lineItemIds: lineItemsByPackage.get(p.id) || [],
    timeline: (eventsByPackage.get(p.id) || []).map((e) => ({
      status: e.status,
      at: e.createdAt.toISOString(),
    })),
  }));

  const rawData = order.raw as any;
  return {
    id: order.id,
    shopId: order.shopId,
    shopName: shopName,
    status: order.status,
    currency: order.currency,
    totalAmount: order.totalAmount?.toString() || null,
    itemCount: lineItems.length,
    createdAt: order.ttsCreatedAt.toISOString(),
    rtsSlaAt: order.rtsSlaAt?.toISOString() || null,
    shippingType: order.shippingType,
    recipientName: maskPii(rawData?.recipient?.name, hasOpsAccess),
    buyerMessage: order.buyerMessage,
    recipient: hasOpsAccess ? (order.recipient as any) : null,
    deliveryOptionName: order.deliveryOptionName,
    warehouseId: order.warehouseId,
    lineItems: lineItems.map((li) => ({
      id: li.id,
      productName: li.productName,
      skuName: li.skuName,
      sellerSku: li.sellerSku,
      salePrice: li.salePrice.toString(),
      displayStatus: li.displayStatus,
      packageId: li.packageId,
    })),
    packages,
  };
}

/** Packages of AWAITING_SHIPMENT orders (excluding FBT), sorted by rts_sla_at asc; with per-bucket counts. (#55) */
export async function getFulfillmentQueue(
  deps: Deps,
  filters: FulfillmentQueueFilters,
): Promise<FulfillmentQueuePage> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const now = deps.now();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // One row per unshipped package whose orders all await shipment (FBT excluded; NULL type is not FBT).
  const where = [
    sql`p.shipped_at IS NULL`,
    sql`o.status = 'AWAITING_SHIPMENT'`,
    sql`o.fulfillment_type IS DISTINCT FROM 'FULFILLMENT_BY_TIKTOK'`,
  ];
  if (filters.shopId) where.push(sql`p.shop_id = ${filters.shopId}`);
  if (filters.warehouseId) where.push(sql`p.warehouse_id = ${filters.warehouseId}`);
  if (filters.shippingType) where.push(sql`p.shipping_type = ${filters.shippingType}`);
  if (filters.deliveryOptionId) where.push(sql`p.delivery_option_id = ${filters.deliveryOptionId}`);
  if (filters.sku) {
    where.push(sql`EXISTS (SELECT 1 FROM package_line_items pli JOIN order_line_items li ON li.id = pli.line_item_id
      WHERE pli.package_id = p.id AND (li.seller_sku = ${filters.sku} OR li.sku_id = ${filters.sku}))`);
  }

  const grouped = sql`
    SELECT p.id AS package_id, p.shop_id, p.status, p.shipping_type, p.warehouse_id, p.handover_method,
           min(o.rts_sla_at) AS rts_sla_at,
           array_agg(DISTINCT o.id ORDER BY o.id) AS order_ids,
           max(o.delivery_option_name) AS delivery_option_name,
           CASE WHEN min(o.rts_sla_at) < ${now.toISOString()}::timestamptz THEN 'overdue'
                WHEN min(o.rts_sla_at) < ${in24h.toISOString()}::timestamptz THEN 'lt24h'
                ELSE 'later' END AS sla_bucket
    FROM packages p
    JOIN order_packages op ON op.package_id = p.id
    JOIN orders o ON o.id = op.order_id
    WHERE ${sql.join(where, sql` AND `)}
    GROUP BY p.id`;

  // Cursor: (rts_sla_at asc nulls last, package_id asc). "~" encodes a NULL sla.
  const page = [sql`TRUE`];
  if (filters.sla) page.push(sql`q.sla_bucket = ${filters.sla}`);
  if (filters.cursor) {
    const [slaRaw, id] = Buffer.from(filters.cursor, "base64url").toString().split("|");
    if (!id) throw new OmsError("invalid_cursor", "Invalid cursor", 400);
    if (slaRaw === "~") {
      page.push(sql`q.rts_sla_at IS NULL AND q.package_id > ${id}`);
    } else {
      const slaAt = new Date(slaRaw!);
      if (Number.isNaN(slaAt.getTime())) throw new OmsError("invalid_cursor", "Invalid cursor", 400);
      // Raw params go to the driver untyped: pass ISO strings and cast (postgres-js rejects Date here).
      const at = slaAt.toISOString();
      page.push(sql`(q.rts_sla_at IS NULL OR q.rts_sla_at > ${at}::timestamptz OR (q.rts_sla_at = ${at}::timestamptz AND q.package_id > ${id}))`);
    }
  }

  type Row = {
    package_id: string; shop_id: string; status: string | null; shipping_type: string | null;
    warehouse_id: string | null; handover_method: string | null; rts_sla_at: Date | string | null;
    order_ids: string[]; delivery_option_name: string | null; sla_bucket: SlaBucket;
  };
  const rows = rowsOf<Row>(await deps.db.execute(sql`
    SELECT * FROM (${grouped}) q
    WHERE ${sql.join(page, sql` AND `)}
    ORDER BY q.rts_sla_at ASC NULLS LAST, q.package_id ASC
    LIMIT ${limit + 1}`));
  const pageRows = rows.slice(0, limit);

  // Line items per package in one query.
  const ids = pageRows.map((r) => r.package_id);
  const lineItems = ids.length
    ? await deps.db
        .select({ packageId: schema.packageLineItems.packageId, sellerSku: schema.orderLineItems.sellerSku, skuId: schema.orderLineItems.skuId })
        .from(schema.packageLineItems)
        .innerJoin(schema.orderLineItems, eq(schema.packageLineItems.lineItemId, schema.orderLineItems.id))
        .where(inArray(schema.packageLineItems.packageId, ids))
    : [];
  const itemsByPackage = new Map<string, { count: number; skus: Set<string> }>();
  for (const li of lineItems) {
    const entry = itemsByPackage.get(li.packageId) ?? { count: 0, skus: new Set<string>() };
    entry.count++;
    entry.skus.add(li.sellerSku ?? li.skuId);
    itemsByPackage.set(li.packageId, entry);
  }

  const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());
  const items: FulfillmentQueueItem[] = pageRows.map((r) => ({
    packageId: r.package_id,
    shopId: r.shop_id,
    orderIds: r.order_ids,
    status: r.status,
    shippingType: r.shipping_type,
    warehouseId: r.warehouse_id,
    deliveryOptionName: r.delivery_option_name,
    handoverMethod: r.handover_method,
    rtsSlaAt: iso(r.rts_sla_at),
    slaBucket: r.sla_bucket,
    itemCount: itemsByPackage.get(r.package_id)?.count ?? 0,
    skus: [...(itemsByPackage.get(r.package_id)?.skus ?? [])],
  }));

  // Bucket counts use the same filters except `sla` and the cursor.
  const counts: Record<SlaBucket, number> = { overdue: 0, lt24h: 0, later: 0 };
  const countRows = rowsOf<{ sla_bucket: SlaBucket; n: number | string }>(
    await deps.db.execute(sql`SELECT q.sla_bucket, count(*) AS n FROM (${grouped}) q GROUP BY q.sla_bucket`),
  );
  for (const c of countRows) counts[c.sla_bucket] = Number(c.n);

  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(`${iso(last.rts_sla_at) ?? "~"}|${last.package_id}`).toString("base64url")
      : null;

  return { items, nextCursor, counts };
}

/** postgres-js returns an array; PGlite returns { rows }. */
function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** Create a jobs row (type "order_export") and enqueue Queues.orderExport. */
export async function startOrderExport(
  deps: Deps,
  filters: OrderListFilters,
  user: SessionUser,
): Promise<{ jobId: string }> {
  const jobs = await deps.db
    .insert(schema.jobs)
    .values({
      type: "order_export",
      status: "queued",
      params: filters,
      createdBy: user.email,
    })
    .returning();

  const job = jobs[0];
  if (!job) throw new Error("Failed to create job");
  await deps.queues.enqueue(Queues.orderExport, { jobId: job.id });
  return { jobId: job.id };
}

function escapeCSV(value: string | null | undefined): string {
  if (!value) return "";
  if (typeof value !== "string") value = String(value);
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Write CSV to config.fileStorageDir, set jobs.result = { filePath }. PII redacted per the creating user's role. */
export async function runOrderExport(deps: Deps, jobId: string): Promise<void> {
  const job = await deps.db.query.jobs.findFirst({
    where: eq(schema.jobs.id, jobId),
  });

  if (!job) throw new OmsError("not_found", "Job not found", 404);

  // Determine user role for PII masking
  let userRole: Role = "viewer";
  if (job.createdBy) {
    const user = await deps.db.query.users.findFirst({
      where: eq(schema.users.email, job.createdBy),
    });
    if (user) userRole = user.role as Role;
  }

  // Prepare directory
  const dir = `${deps.config.fileStorageDir}/exports`;
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${jobId}.csv`;

  // Create write stream
  const stream = createWriteStream(filePath);

  // Write CSV header
  const headers = [
    "Order ID", "Shop ID", "Shop Name", "Status", "Currency", "Total Amount",
    "Item Count", "Created At", "RTS SLA At", "Shipping Type", "Recipient Name",
  ];
  stream.write(headers.map(escapeCSV).join(",") + "\n");

  // Iterate through all orders with pagination
  const filters = job.params as OrderListFilters || {};
  let cursor: string | undefined;
  let total = 0;

  // Mock user with the job's creator's role
  const creatorUser: SessionUser = {
    id: "system",
    email: job.createdBy || "system",
    name: null,
    role: userRole,
  };

  while (true) {
    const page = await listOrders(deps, { ...filters, cursor, limit: 200 }, creatorUser);

    for (const order of page.items) {
      const row = [
        order.id,
        order.shopId,
        order.shopName,
        order.status,
        order.currency,
        String(order.totalAmount || ""),
        String(order.itemCount),
        order.createdAt,
        order.rtsSlaAt || "",
        order.shippingType || "",
        order.recipientName || "",
      ];
      stream.write(row.map(v => escapeCSV(v)).join(",") + "\n");
      total++;
    }

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  // Close stream
  await new Promise((resolve, reject) => {
    stream.end(() => resolve(undefined));
    stream.on("error", reject);
  });

  // Update job
  await deps.db
    .update(schema.jobs)
    .set({
      status: "succeeded",
      total,
      succeeded: total,
      result: { filePath, contentType: "text/csv" },
      finishedAt: deps.now(),
    })
    .where(eq(schema.jobs.id, jobId));
}

export async function getJob(deps: Deps, jobId: string): Promise<JobView | null> {
  try {
    const job = await deps.db.query.jobs.findFirst({
      where: eq(schema.jobs.id, jobId),
    });

    if (!job) return null;

    // Get job items
    const items = await deps.db.query.jobItems.findMany({
      where: eq(schema.jobItems.jobId, job.id),
    });

    const result = job.result as any;
    const hasDownloadUrl = result?.filePath ? true : false;

    return {
      id: job.id,
      type: job.type,
      status: job.status as any,
      total: job.total,
      succeeded: job.succeeded,
      failed: job.failed,
      error: job.error,
      downloadUrl: hasDownloadUrl ? `/v1/jobs/${jobId}/download` : null,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() || null,
      items: items.map((item) => ({
        targetId: item.targetId,
        status: item.status,
        error: item.error,
      })),
    };
  } catch (e) {
    // Invalid UUID or other database error - return null
    return null;
  }
}
