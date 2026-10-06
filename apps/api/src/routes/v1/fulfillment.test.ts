import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../../app.js";
import { createTestDeps, ttsOk } from "@oms/core/testing";
import { schema } from "@oms/db";

describe("fulfillment routes", () => {
  let testEnv: Awaited<ReturnType<typeof createTestDeps>>;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    testEnv = await createTestDeps();
    const { deps } = testEnv;

    // Set up test data
    await deps.db.insert(schema.authorizations).values({
      id: "auth-1",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      region: "US",
      userType: 1,
      accessTokenEnc: "enc",
      accessTokenExpiresAt: new Date(Date.now() + 86400000),
      refreshTokenEnc: "enc",
      refreshTokenExpiresAt: new Date(Date.now() + 86400000),
    });

    await deps.db.insert(schema.shops).values({
      id: "shop-1",
      name: "Test Shop",
      region: "US",
      cipher: "c",
      authorizationId: "auth-1",
    });

    await deps.db.insert(schema.warehouses).values({
      shopId: "shop-1",
      id: "wh-1",
      name: "Main Warehouse",
      isDefault: true,
      defaultHandoverMethod: "DROP_OFF",
    });

    await deps.db.insert(schema.orders).values({
      id: "order-1",
      shopId: "shop-1",
      status: "AWAITING_SHIPMENT",
      currency: "USD",
      ttsCreatedAt: new Date(),
      ttsUpdatedAt: 100,
      raw: {},
      recipientHash: "hash-123",
    });

    await deps.db.insert(schema.packages).values({
      id: "pkg-1",
      shopId: "shop-1",
      status: "READY_TO_SHIP",
      shippingType: "TIKTOK",
      warehouseId: "wh-1",
    });

    await deps.db.insert(schema.orderPackages).values({
      orderId: "order-1",
      packageId: "pkg-1",
    });

    app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "u1", email: "ops@x.y", name: null, role: "ops" },
    });
  });

  describe("POST /v1/packages/:id/ship", () => {
    it("requires Idempotency-Key header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/packages/pkg-1/ship",
        payload: { handoverMethod: "DROP_OFF" },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("idempotency_key_required");
    });

    it("rejects invalid Idempotency-Key", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/packages/pkg-1/ship",
        headers: {
          "idempotency-key": "short",
        },
        payload: { handoverMethod: "DROP_OFF" },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("idempotency_key_invalid");
    });

    it("requires ops role", async () => {
      app = await buildApp({
        deps: testEnv.deps,
        logger: false,
        testUser: { id: "u1", email: "viewer@x.y", name: null, role: "viewer" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/v1/packages/pkg-1/ship",
        headers: {
          "idempotency-key": "key-123456789",
        },
        payload: { handoverMethod: "DROP_OFF" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("returns 401 when not authenticated", async () => {
      app = await buildApp({
        deps: testEnv.deps,
        logger: false,
      });

      const response = await app.inject({
        method: "POST",
        url: "/v1/packages/pkg-1/ship",
        headers: {
          "idempotency-key": "key-123456789",
        },
        payload: { handoverMethod: "DROP_OFF" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /v1/fulfillment/batch-ship", () => {
    it("creates a batch ship job", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/batch-ship",
        payload: { packageIds: ["pkg-1"] },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({ jobId: expect.any(String) });
    });

    it("validates packageIds array", async () => {
      let response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/batch-ship",
        payload: { packageIds: [] },
      });

      expect(response.statusCode).toBe(400);

      response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/batch-ship",
        payload: { packageIds: Array(501).fill("pkg") },
      });

      expect(response.statusCode).toBe(400);
    });

    it("requires ops role", async () => {
      app = await buildApp({
        deps: testEnv.deps,
        logger: false,
        testUser: { id: "u1", email: "viewer@x.y", name: null, role: "viewer" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/batch-ship",
        payload: { packageIds: ["pkg-1"] },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("POST /v1/fulfillment/labels", () => {
    it("creates a label job", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/labels",
        payload: { packageIds: ["pkg-1"], documentType: "SHIPPING_LABEL" },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({ jobId: expect.any(String) });
    });

    it("validates packageIds array", async () => {
      let response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/labels",
        payload: { packageIds: [], documentType: "SHIPPING_LABEL" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("validates documentType", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/labels",
        payload: { packageIds: ["pkg-1"], documentType: "INVALID" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("requires ops role", async () => {
      app = await buildApp({
        deps: testEnv.deps,
        logger: false,
        testUser: { id: "u1", email: "viewer@x.y", name: null, role: "viewer" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/v1/fulfillment/labels",
        payload: { packageIds: ["pkg-1"], documentType: "SHIPPING_LABEL" },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
