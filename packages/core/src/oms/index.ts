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
  const items = orders.slice(0, limit).map(({ orders: o, shops: s }) => {
    const recipient = o.recipient as any;
    return {
      id: o.id,
      shopId: o.shopId,
      shopName: s?.name || "",
      status: o.status,
      currency: o.currency,
      totalAmount: o.totalAmount?.toString() || null,
      itemCount: 0, // Will be computed separately if needed
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
  const limit = Math.min(filters.limit ?? 50, 200);
  const now = deps.now();

  // Parse cursor
  let cursorSlaAt: Date | null = null;
  let cursorId: string | undefined;
  if (filters.cursor) {
    const [slaAt, id] = Buffer.from(filters.cursor, "base64url").toString().split("|");
    if (id) {
      cursorSlaAt = slaAt ? new Date(slaAt) : null;
      cursorId = id;
    }
  }

  // Build filter conditions
  const conditions: any[] = [eq(schema.orders.status, "AWAITING_SHIPMENT")];

  if (filters.shopId) conditions.push(eq(schema.packages.shopId, filters.shopId));
  if (filters.warehouseId) conditions.push(eq(schema.packages.warehouseId, filters.warehouseId));
  if (filters.shippingType) conditions.push(eq(schema.packages.shippingType, filters.shippingType));
  if (filters.deliveryOptionId) conditions.push(eq(schema.packages.deliveryOptionId, filters.deliveryOptionId));

  if (filters.sku) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM order_line_items WHERE order_id = ${schema.orders.id} AND (seller_sku = ${filters.sku} OR sku_id = ${filters.sku}))`
    );
  }

  // Exclude FBT
  conditions.push(sql`${schema.orders.fulfillmentType} != 'FULFILLMENT_BY_TIKTOK'`);

  // Exclude already shipped
  conditions.push(isNull(schema.packages.shippedAt));

  // Apply SLA filter if specified
  if (filters.sla) {
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

  // Keyset pagination
  if (cursorId) {
    if (cursorSlaAt) {
      conditions.push(
        or(
          lt(schema.orders.rtsSlaAt, cursorSlaAt),
          and(eq(schema.orders.rtsSlaAt, cursorSlaAt), lt(schema.packages.id, cursorId)),
        ),
      );
    } else {
      conditions.push(or(
        lt(schema.orders.rtsSlaAt, sql`NULL`),
        and(
          sql`${schema.orders.rtsSlaAt} IS NULL`,
          lt(schema.packages.id, cursorId),
        ),
      ));
    }
  }

  // Query packages with their orders
  const results = await deps.db
    .select({
      packageId: schema.packages.id,
      shopId: schema.packages.shopId,
      orderId: schema.orders.id,
      rtsSlaAt: schema.orders.rtsSlaAt,
      status: schema.packages.status,
      shippingType: schema.packages.shippingType,
      warehouseId: schema.packages.warehouseId,
      deliveryOptionName: schema.orders.deliveryOptionName,
      handoverMethod: schema.packages.handoverMethod,
    })
    .from(schema.packages)
    .innerJoin(schema.orderPackages, eq(schema.packages.id, schema.orderPackages.packageId))
    .innerJoin(schema.orders, eq(schema.orderPackages.orderId, schema.orders.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schema.orders.rtsSlaAt), asc(schema.packages.id))
    .limit(limit + 1);

  // Group by package and aggregate orders
  const packageMap = new Map<
    string,
    {
      orders: Set<string>;
      rtsSlaAt: Date | null;
      status: string | null;
      shippingType: string | null;
      warehouseId: string | null;
      deliveryOptionName: string | null;
      handoverMethod: string | null;
      shopId: string;
    }
  >();

  for (const row of results.slice(0, limit)) {
    if (!packageMap.has(row.packageId)) {
      packageMap.set(row.packageId, {
        orders: new Set(),
        rtsSlaAt: row.rtsSlaAt,
        status: row.status,
        shippingType: row.shippingType,
        warehouseId: row.warehouseId,
        deliveryOptionName: row.deliveryOptionName,
        handoverMethod: row.handoverMethod,
        shopId: row.shopId,
      });
    }
    packageMap.get(row.packageId)!.orders.add(row.orderId);
  }

  // Get SKUs for each package
  const packageIds = Array.from(packageMap.keys());
  const lineItems = await deps.db
    .select({
      packageId: schema.packageLineItems.packageId,
      sellerSku: schema.orderLineItems.sellerSku,
    })
    .from(schema.packageLineItems)
    .innerJoin(schema.orderLineItems, eq(schema.packageLineItems.lineItemId, schema.orderLineItems.id))
    .where(inArray(schema.packageLineItems.packageId, packageIds));

  const skusByPackage = new Map<string, Set<string>>();
  let totalLineItemCount = 0;
  for (const item of lineItems) {
    if (!skusByPackage.has(item.packageId)) skusByPackage.set(item.packageId, new Set());
    if (item.sellerSku) skusByPackage.get(item.packageId)!.add(item.sellerSku);
    totalLineItemCount++;
  }

  // Build result items
  const items: FulfillmentQueueItem[] = Array.from(packageMap.entries()).map(([packageId, data]) => {
    const slaBucket = getSlaBucket(data.rtsSlaAt, now);
    const skus = Array.from(skusByPackage.get(packageId) || []);
    return {
      packageId,
      shopId: data.shopId,
      orderIds: Array.from(data.orders),
      status: data.status,
      shippingType: data.shippingType,
      warehouseId: data.warehouseId,
      deliveryOptionName: data.deliveryOptionName,
      handoverMethod: data.handoverMethod,
      rtsSlaAt: data.rtsSlaAt?.toISOString() || null,
      slaBucket,
      itemCount: skus.length,
      skus,
    };
  });

  // Compute counts without the sla filter
  let counts = { overdue: 0, lt24h: 0, later: 0 };
  if (!filters.sla) {
    const countConditions = conditions.filter((c) => !c.includes?.("rtsSlaAt"));
    const countResults = await deps.db
      .select({ rtsSlaAt: schema.orders.rtsSlaAt })
      .from(schema.packages)
      .innerJoin(schema.orderPackages, eq(schema.packages.id, schema.orderPackages.packageId))
      .innerJoin(schema.orders, eq(schema.orderPackages.orderId, schema.orders.id))
      .where(countConditions.length > 0 ? and(...countConditions) : undefined);

    for (const row of countResults) {
      const bucket = getSlaBucket(row.rtsSlaAt, now);
      counts[bucket]++;
    }
  }

  let nextCursor: string | null = null;
  if (results.length > limit && items.length > 0) {
    const lastItem = items[items.length - 1]!;
    nextCursor = Buffer.from(`${lastItem.rtsSlaAt || ""}|${lastItem.packageId}`).toString("base64url");
  }

  return { items, nextCursor, counts };
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
