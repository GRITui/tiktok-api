import { describe, it, expect, beforeEach } from "vitest";
import { createTestDeps } from "@oms/core/testing";
import { buildApp } from "../../app.js";
import { schema } from "@oms/db";

describe("Orders Routes", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps();
    deps = result.deps;
  });

  async function seedTestData() {
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

    await deps.db.insert(schema.orderLineItems).values({
      id: "line-1",
      orderId: "order-1",
      productId: "prod-1",
      skuId: "sku-1",
      sellerSku: "seller-sku-1",
      productName: "Test Product",
      salePrice: "50.00",
    });
  }

  it("GET /v1/orders returns orders list", async () => {
    await seedTestData();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/orders",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("order-1");
  });

  it("GET /v1/orders requires authentication", async () => {
    const app = await buildApp({ deps, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/v1/orders",
    });

    expect(response.statusCode).toBe(401);
  });

  it("GET /v1/orders/:id returns order detail", async () => {
    await seedTestData();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "ops" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/orders/order-1",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe("order-1");
    expect(body.lineItems).toHaveLength(1);
  });

  it("GET /v1/orders/:id returns 404 for nonexistent order", async () => {
    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/orders/nonexistent",
    });

    expect(response.statusCode).toBe(404);
  });

  it("POST /v1/exports/orders requires ops role", async () => {
    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/exports/orders",
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it("POST /v1/exports/orders creates job and returns 202", async () => {
    await seedTestData();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "ops@example.com", name: null, role: "ops" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/exports/orders",
      payload: { shopId: "shop-1" },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.jobId).toBeDefined();
  });
});
