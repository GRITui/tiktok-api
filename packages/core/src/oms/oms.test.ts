import { describe, it, expect, beforeEach } from "vitest";
import { createTestDeps } from "../testing.js";
import {
  createUser,
  login,
  getSessionUser,
  logout,
  listOrders,
  getOrderDetail,
  startOrderExport,
  runOrderExport,
  getJob,
  getFulfillmentQueue,
  OmsError,
  type SessionUser,
} from "./index.js";
import { schema } from "@oms/db";
import { eq } from "drizzle-orm";
import { Queues } from "../queues.js";

describe("OMS Auth", () => {
  let deps: any;
  let setNow: any;
  let testUser: SessionUser;

  beforeEach(async () => {
    const result = await createTestDeps();
    deps = result.deps;
    setNow = result.setNow;
  });

  it("createUser hashes password and stores user", async () => {
    const user = await createUser(deps, {
      email: "test@example.com",
      password: "secret123",
      role: "viewer",
      name: "Test User",
    });

    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test User");
    expect(user.role).toBe("viewer");

    // Verify user exists in DB
    const dbUser = await deps.db.query.users.findFirst({
      where: eq(schema.users.email, "test@example.com"),
    });
    expect(dbUser).toBeDefined();
    expect(dbUser?.passwordHash).toMatch(/^scrypt\$/);
  });

  it("createUser rejects duplicate email", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret",
      role: "viewer",
    });

    await expect(
      createUser(deps, {
        email: "test@example.com",
        password: "other",
        role: "admin",
      }),
    ).rejects.toThrow("Email already registered");
  });

  it("createUser lowercases email", async () => {
    const user = await createUser(deps, {
      email: "Test@Example.COM",
      password: "secret",
      role: "viewer",
    });

    expect(user.email).toBe("test@example.com");
  });

  it("login succeeds with correct credentials", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret123",
      role: "admin",
    });

    const result = await login(deps, {
      email: "test@example.com",
      password: "secret123",
    });

    expect(result.user.email).toBe("test@example.com");
    expect(result.token).toBeDefined();
    expect(result.expiresAt.getTime()).toBeGreaterThan(deps.now().getTime());
  });

  it("login rejects invalid password", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret123",
      role: "viewer",
    });

    await expect(
      login(deps, { email: "test@example.com", password: "wrong" }),
    ).rejects.toThrow("Invalid email or password");
  });

  it("login rejects nonexistent email", async () => {
    await expect(
      login(deps, { email: "nonexistent@example.com", password: "secret" }),
    ).rejects.toThrow("Invalid email or password");
  });

  it("login lowercases email", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret",
      role: "viewer",
    });

    const result = await login(deps, {
      email: "TEST@EXAMPLE.COM",
      password: "secret",
    });

    expect(result.user.email).toBe("test@example.com");
  });

  it("getSessionUser retrieves valid session", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret",
      role: "ops",
    });

    const { token } = await login(deps, {
      email: "test@example.com",
      password: "secret",
    });

    const user = await getSessionUser(deps, token);
    expect(user).toBeDefined();
    expect(user?.email).toBe("test@example.com");
    expect(user?.role).toBe("ops");
  });

  it("getSessionUser returns null for expired session", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret",
      role: "viewer",
    });

    const { token } = await login(deps, {
      email: "test@example.com",
      password: "secret",
    });

    // Advance time past session expiry
    setNow(new Date(deps.now().getTime() + 24 * 60 * 60 * 1000));

    const user = await getSessionUser(deps, token);
    expect(user).toBeNull();
  });

  it("getSessionUser returns null for invalid token", async () => {
    const user = await getSessionUser(deps, "invalid-token");
    expect(user).toBeNull();
  });

  it("logout deletes session", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret",
      role: "viewer",
    });

    const { token } = await login(deps, {
      email: "test@example.com",
      password: "secret",
    });

    await logout(deps, token);

    const user = await getSessionUser(deps, token);
    expect(user).toBeNull();
  });
});

describe("OMS Orders", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps();
    deps = result.deps;
  });

  async function seedOrder(overrides: any = {}) {
    const shopId = overrides.shopId || "shop-1";

    // Only insert shop if it doesn't already exist
    const existingShop = await deps.db.query.shops.findFirst({
      where: eq(schema.shops.id, shopId),
    });

    if (!existingShop) {
      await deps.db.insert(schema.shops).values({
        id: shopId,
        name: `Shop ${shopId}`,
        region: "US",
        cipher: "test",
        authorizationId: "auth-1",
        active: true,
      });
    }

    const order = await deps.db
      .insert(schema.orders)
      .values({
        id: overrides.id || "order-1",
        shopId: shopId,
        status: "AWAITING_SHIPMENT",
        currency: "USD",
        totalAmount: "123.45",
        buyerUserId: "buyer-1",
        buyerMessage: "Please ship fast",
        recipient: { name: "John Doe", address: "123 Main St" },
        fulfillmentType: "SELLER",
        shippingType: "SELLER",
        deliveryOptionId: "delivery-1",
        deliveryOptionName: "Standard",
        warehouseId: "warehouse-1",
        rtsSlaAt: new Date(deps.now().getTime() + 24 * 60 * 60 * 1000),
        ttsCreatedAt: new Date(deps.now().getTime() - 60 * 60 * 1000),
        ttsUpdatedAt: Math.floor(Date.now() / 1000),
        raw: { id: overrides.id || "order-1" },
        ...overrides,
      })
      .returning();

    return order[0];
  }

  it("listOrders returns orders", async () => {
    const auth = await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await seedOrder();

    const viewer: SessionUser = {
      id: "user-1",
      email: "viewer@example.com",
      name: null,
      role: "viewer",
    };

    const page = await listOrders(deps, {}, viewer);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe("order-1");
  });

  it("listOrders masks PII for viewers", async () => {
    const auth = await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await seedOrder();

    const viewer: SessionUser = {
      id: "user-1",
      email: "viewer@example.com",
      name: null,
      role: "viewer",
    };

    const page = await listOrders(deps, {}, viewer);
    expect(page.items[0].recipientName).not.toBe("John Doe");
    expect(page.items[0].recipientName).toMatch(/J\*+e/);
  });

  it("listOrders shows PII for ops", async () => {
    const auth = await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await seedOrder();

    const ops: SessionUser = {
      id: "user-1",
      email: "ops@example.com",
      name: null,
      role: "ops",
    };

    const page = await listOrders(deps, {}, ops);
    expect(page.items[0].recipientName).toBe("John Doe");
  });

  it("listOrders filters by shopId", async () => {
    const auth = await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await seedOrder();
    await seedOrder({ id: "order-2", shopId: "shop-2" });

    const viewer: SessionUser = {
      id: "user-1",
      email: "viewer@example.com",
      name: null,
      role: "viewer",
    };

    const page = await listOrders(deps, { shopId: "shop-1" }, viewer);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe("order-1");
  });

  it("getOrderDetail returns order with details", async () => {
    const auth = await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await seedOrder();

    // Add line item
    await deps.db.insert(schema.orderLineItems).values({
      id: "line-1",
      orderId: "order-1",
      productId: "prod-1",
      skuId: "sku-1",
      sellerSku: "seller-sku-1",
      productName: "Test Product",
      skuName: "Test SKU",
      salePrice: "50.00",
      displayStatus: "In Stock",
    });

    const ops: SessionUser = {
      id: "user-1",
      email: "ops@example.com",
      name: null,
      role: "ops",
    };

    const detail = await getOrderDetail(deps, "order-1", ops);
    expect(detail).toBeDefined();
    expect(detail?.id).toBe("order-1");
    expect(detail?.lineItems).toHaveLength(1);
    expect(detail?.recipient).toBeDefined();
  });

  it("getOrderDetail masks PII for viewers", async () => {
    const auth = await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await seedOrder();

    const viewer: SessionUser = {
      id: "user-1",
      email: "viewer@example.com",
      name: null,
      role: "viewer",
    };

    const detail = await getOrderDetail(deps, "order-1", viewer);
    expect(detail?.recipient).toBeNull();
    expect(detail?.recipientName).not.toBe("John Doe");
  });

  it("getOrderDetail returns null for nonexistent order", async () => {
    const viewer: SessionUser = {
      id: "user-1",
      email: "viewer@example.com",
      name: null,
      role: "viewer",
    };

    const detail = await getOrderDetail(deps, "nonexistent", viewer);
    expect(detail).toBeNull();
  });
});

describe("OMS Export", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps({
      fileStorageDir: "/tmp/test-oms-exports-" + Date.now(),
    });
    deps = result.deps;
  });

  it("startOrderExport creates job and enqueues", async () => {
    const user: SessionUser = {
      id: "user-1",
      email: "ops@example.com",
      name: null,
      role: "ops",
    };

    const { jobId } = await startOrderExport(deps, {}, user);
    expect(jobId).toBeDefined();

    // Check job was created
    const job = await deps.db.query.jobs.findFirst({
      where: eq(schema.jobs.id, jobId),
    });
    expect(job).toBeDefined();
    expect(job?.type).toBe("order_export");
    expect(job?.status).toBe("queued");
    expect(job?.createdBy).toBe("ops@example.com");

    // Check job was enqueued
    const enqueued = deps.queues.jobs.find(
      (j: any) => j.queue === Queues.orderExport,
    );
    expect(enqueued).toBeDefined();
    expect(enqueued?.data.jobId).toBe(jobId);
  });

  it("runOrderExport writes CSV file", async () => {
    // Setup auth and shop for the test
    const auth = await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    const shop = await deps.db.insert(schema.shops).values({
      id: "shop-1",
      name: "Test Shop",
      region: "US",
      cipher: "test",
      authorizationId: "auth-1",
      active: true,
    });

    // Create an order
    const order = await deps.db.insert(schema.orders).values({
      id: "order-1",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      currency: "USD",
      totalAmount: "100.00",
      buyerUserId: "buyer-1",
      recipient: { name: "John Doe" },
      ttsCreatedAt: new Date(deps.now().getTime() - 60 * 60 * 1000),
      ttsUpdatedAt: Math.floor(Date.now() / 1000),
      raw: { id: "order-1" },
    });

    const user = await deps.db.insert(schema.users).values({
      email: "ops@example.com",
      role: "ops",
      passwordHash: "hash",
    });

    // Create export job
    const job = await deps.db.insert(schema.jobs).values({
      type: "order_export",
      status: "running",
      params: {},
      createdBy: "ops@example.com",
    }).returning();

    await runOrderExport(deps, job[0].id);

    // Check job status
    const updated = await deps.db.query.jobs.findFirst({
      where: eq(schema.jobs.id, job[0].id),
    });
    expect(updated?.status).toBe("succeeded");
    expect(updated?.result?.filePath).toBeDefined();
    expect(updated?.result?.contentType).toBe("text/csv");
    expect(updated?.total).toBeGreaterThan(0);
  });
});

describe("OMS Jobs", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps();
    deps = result.deps;
  });

  it("getJob returns job view", async () => {
    const job = await deps.db.insert(schema.jobs).values({
      type: "order_export",
      status: "succeeded",
      total: 10,
      succeeded: 10,
      failed: 0,
      result: { filePath: "/tmp/export.csv", contentType: "text/csv" },
      createdAt: deps.now(),
    }).returning();

    const view = await getJob(deps, job[0].id);
    expect(view).toBeDefined();
    expect(view?.type).toBe("order_export");
    expect(view?.status).toBe("succeeded");
    expect(view?.downloadUrl).toBe(`/v1/jobs/${job[0].id}/download`);
  });

  it("getJob returns null for nonexistent job", async () => {
    const view = await getJob(deps, "nonexistent");
    expect(view).toBeNull();
  });
});

describe("OMS Fulfillment Queue", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps();
    deps = result.deps;
  });

  async function seedFulfillmentData() {
    // Create auth and shop
    await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    const shop = await deps.db.insert(schema.shops).values({
      id: "shop-1",
      name: "Test Shop",
      region: "US",
      cipher: "test",
      authorizationId: "auth-1",
      active: true,
    });

    // Create order with AWAITING_SHIPMENT status and non-FBT fulfillment
    const order = await deps.db.insert(schema.orders).values({
      id: "order-1",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      currency: "USD",
      fulfillmentType: "SELLER",
      shippingType: "SELLER",
      deliveryOptionId: "delivery-1",
      deliveryOptionName: "Standard",
      warehouseId: "warehouse-1",
      rtsSlaAt: new Date(deps.now().getTime() + 12 * 60 * 60 * 1000),
      ttsCreatedAt: new Date(),
      ttsUpdatedAt: Math.floor(Date.now() / 1000),
      raw: { id: "order-1" },
    });

    // Create package (not shipped)
    const pkg = await deps.db.insert(schema.packages).values({
      id: "pkg-1",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      shippingType: "SELLER",
      deliveryOptionId: "delivery-1",
      warehouseId: "warehouse-1",
      shippedAt: null, // not shipped
    });

    // Link order to package
    await deps.db.insert(schema.orderPackages).values({
      orderId: "order-1",
      packageId: "pkg-1",
    });

    // Create line item
    const lineItem = await deps.db.insert(schema.orderLineItems).values({
      id: "line-1",
      orderId: "order-1",
      productId: "prod-1",
      skuId: "sku-1",
      sellerSku: "seller-sku-1",
      productName: "Product 1",
      salePrice: "50.00",
      packageId: "pkg-1",
    });

    // Link line item to package
    await deps.db.insert(schema.packageLineItems).values({
      packageId: "pkg-1",
      lineItemId: "line-1",
    });

    return { order, pkg, lineItem };
  }

  it("getFulfillmentQueue returns packages awaiting shipment", async () => {
    await seedFulfillmentData();

    const queue = await getFulfillmentQueue(deps, {});
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].packageId).toBe("pkg-1");
  });

  it("getFulfillmentQueue excludes FBT orders", async () => {
    // Create FBT order
    await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await deps.db.insert(schema.shops).values({
      id: "shop-1",
      name: "Test Shop",
      region: "US",
      cipher: "test",
      authorizationId: "auth-1",
      active: true,
    });

    const order = await deps.db.insert(schema.orders).values({
      id: "order-fbt",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      currency: "USD",
      fulfillmentType: "FULFILLMENT_BY_TIKTOK",
      ttsCreatedAt: new Date(),
      ttsUpdatedAt: Math.floor(Date.now() / 1000),
      raw: { id: "order-fbt" },
    });

    const pkg = await deps.db.insert(schema.packages).values({
      id: "pkg-fbt",
      shopId: "shop-1",
      shippedAt: null,
    });

    await deps.db.insert(schema.orderPackages).values({
      orderId: "order-fbt",
      packageId: "pkg-fbt",
    });

    const queue = await getFulfillmentQueue(deps, {});
    expect(queue.items.find((i) => i.packageId === "pkg-fbt")).toBeUndefined();
  });

  it("getFulfillmentQueue excludes already shipped packages", async () => {
    await seedFulfillmentData();

    // Create a shipped package
    await deps.db.insert(schema.packages).values({
      id: "pkg-shipped",
      shopId: "shop-1",
      shippedAt: new Date(), // Already shipped
    });

    const order = await deps.db.query.orders.findFirst({
      where: eq(schema.orders.id, "order-1"),
    });

    await deps.db.insert(schema.orderPackages).values({
      orderId: "order-1",
      packageId: "pkg-shipped",
    });

    const queue = await getFulfillmentQueue(deps, {});
    expect(queue.items.find((i) => i.packageId === "pkg-shipped")).toBeUndefined();
  });

  it("getFulfillmentQueue calculates SLA buckets", async () => {
    // Create orders with different SLA times
    await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(),
    });

    await deps.db.insert(schema.shops).values({
      id: "shop-1",
      name: "Test Shop",
      region: "US",
      cipher: "test",
      authorizationId: "auth-1",
      active: true,
    });

    const overdue = await deps.db.insert(schema.orders).values({
      id: "order-overdue",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      currency: "USD",
      fulfillmentType: "SELLER",
      rtsSlaAt: new Date(deps.now().getTime() - 1000),
      ttsCreatedAt: new Date(),
      ttsUpdatedAt: Math.floor(Date.now() / 1000),
      raw: {},
    });

    const lt24h = await deps.db.insert(schema.orders).values({
      id: "order-lt24h",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      currency: "USD",
      fulfillmentType: "SELLER",
      rtsSlaAt: new Date(deps.now().getTime() + 12 * 60 * 60 * 1000),
      ttsCreatedAt: new Date(),
      ttsUpdatedAt: Math.floor(Date.now() / 1000),
      raw: {},
    });

    // Create packages
    for (const oid of ["order-overdue", "order-lt24h"]) {
      const pkg = await deps.db.insert(schema.packages).values({
        id: `pkg-${oid}`,
        shopId: "shop-1",
        shippedAt: null,
      }).returning();

      await deps.db.insert(schema.orderPackages).values({
        orderId: oid,
        packageId: pkg[0].id,
      });
    }

    const queue = await getFulfillmentQueue(deps, {});
    const overduePkg = queue.items.find((i) => i.packageId === "pkg-order-overdue");
    const lt24hPkg = queue.items.find((i) => i.packageId === "pkg-order-lt24h");

    expect(overduePkg?.slaBucket).toBe("overdue");
    expect(lt24hPkg?.slaBucket).toBe("lt24h");
  });

  it("getFulfillmentQueue returns counts per bucket", async () => {
    await seedFulfillmentData();
    const queue = await getFulfillmentQueue(deps, {});
    expect(queue.counts).toBeDefined();
    expect(queue.counts.lt24h).toBeGreaterThanOrEqual(1);
  });
});
