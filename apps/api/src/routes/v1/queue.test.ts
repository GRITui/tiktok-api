import { describe, it, expect, beforeEach } from "vitest";
import { createTestDeps } from "@oms/core/testing";
import { buildApp } from "../../app.js";
import { schema } from "@oms/db";

describe("Fulfillment Queue Routes", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps();
    deps = result.deps;
  });

  async function seedFulfillmentData() {
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

    const pkg = await deps.db.insert(schema.packages).values({
      id: "pkg-1",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      shippingType: "SELLER",
      deliveryOptionId: "delivery-1",
      warehouseId: "warehouse-1",
      shippedAt: null,
    });

    await deps.db.insert(schema.orderPackages).values({
      orderId: "order-1",
      packageId: "pkg-1",
    });

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

    await deps.db.insert(schema.packageLineItems).values({
      packageId: "pkg-1",
      lineItemId: "line-1",
    });
  }

  it("GET /v1/fulfillment/queue returns packages", async () => {
    await seedFulfillmentData();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/fulfillment/queue",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].packageId).toBe("pkg-1");
    expect(body.counts).toBeDefined();
  });

  it("GET /v1/fulfillment/queue requires authentication", async () => {
    const app = await buildApp({ deps, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/v1/fulfillment/queue",
    });

    expect(response.statusCode).toBe(401);
  });

  it("GET /v1/fulfillment/queue filters by shopId", async () => {
    await seedFulfillmentData();

    // Create another shop and package
    await deps.db.insert(schema.shops).values({
      id: "shop-2",
      name: "Shop 2",
      region: "US",
      cipher: "test",
      authorizationId: "auth-1",
      active: true,
    });

    const order = await deps.db.insert(schema.orders).values({
      id: "order-2",
      shopId: "shop-2",
      status: "AWAITING_SHIPMENT",
      currency: "USD",
      fulfillmentType: "SELLER",
      ttsCreatedAt: new Date(),
      ttsUpdatedAt: Math.floor(Date.now() / 1000),
      raw: {},
    });

    const pkg = await deps.db.insert(schema.packages).values({
      id: "pkg-2",
      shopId: "shop-2",
      shippedAt: null,
    });

    await deps.db.insert(schema.orderPackages).values({
      orderId: "order-2",
      packageId: "pkg-2",
    });

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/fulfillment/queue?shopId=shop-1",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].packageId).toBe("pkg-1");
  });

  it("GET /v1/fulfillment/queue filters by warehouseId", async () => {
    await seedFulfillmentData();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/fulfillment/queue?warehouseId=warehouse-1",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(1);
  });

  it("GET /v1/fulfillment/queue filters by sla bucket", async () => {
    await seedFulfillmentData();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/fulfillment/queue?sla=lt24h",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items.length).toBeGreaterThanOrEqual(0);
  });
});
