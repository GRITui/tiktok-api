import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../app.js";
import { createTestDeps, ttsOk } from "@oms/core/testing";

vi.mock("../../auth/index.js", () => ({
  getShopContext: vi.fn(async (_d, shopId) => ({ shopId, region: "US", accessToken: "t", shopCipher: "c" })),
}));
vi.mock("../../orders/index.js");
vi.mock("../../oms/index.js");
vi.mock("../../fulfillment/index.js");

// Helper to seed initial data
async function seedShop(testDeps: any, shopId: string) {
  const { authorizations, shops } = await import("@oms/db");
  const authId = `auth_${shopId}`;

  try {
    await testDeps.deps.db.insert(authorizations).values({
      id: authId,
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      region: "US",
      userType: 1,
      accessTokenEnc: "encrypted",
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: "encrypted",
      refreshTokenExpiresAt: new Date(),
    });
  } catch (e) {
    // Ignore if already exists
  }

  try {
    await testDeps.deps.db.insert(shops).values({
      id: shopId,
      name: "Test Shop",
      region: "US",
      cipher: "c",
      authorizationId: authId,
      active: true,
    });
  } catch (e) {
    // Ignore if already exists
  }
}

describe("Logistics API Routes", () => {
  it("GET /shops/:shopId/warehouses returns warehouses", async () => {
    const testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");

    const app = await buildApp({
      deps: testDeps.deps,
      logger: false,
      testUser: { id: "u1", email: "a@b.c", name: null, role: "viewer" },
    });

    const { warehouses } = await import("@oms/db");
    await testDeps.deps.db.insert(warehouses).values({
      shopId: "shop1",
      id: "wh1",
      name: "Warehouse 1",
      isDefault: true,
      defaultHandoverMethod: "PICKUP",
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/shops/shop1/warehouses",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("wh1");
  });

  it("POST /shops/:shopId/logistics/sync enqueues job", async () => {
    const testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");

    const app = await buildApp({
      deps: testDeps.deps,
      logger: false,
      testUser: { id: "u1", email: "a@b.c", name: null, role: "ops" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/shops/shop1/logistics/sync",
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    const job = testDeps.queues.jobs.find((j: any) => j.queue === "tts-logistics-sync");
    expect(job).toBeDefined();
    expect(job?.data.shopId).toBe("shop1");
  });

  it("PATCH /shops/:shopId/warehouses/:warehouseId updates settings", async () => {
    const testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");

    const app = await buildApp({
      deps: testDeps.deps,
      logger: false,
      testUser: { id: "u1", email: "a@b.c", name: null, role: "admin" },
    });

    const { warehouses } = await import("@oms/db");
    await testDeps.deps.db.insert(warehouses).values({
      shopId: "shop1",
      id: "wh1",
      name: "Warehouse 1",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/shops/shop1/warehouses/wh1",
      payload: { isDefault: true, defaultHandoverMethod: "DROP_OFF" },
    });

    expect(res.statusCode).toBe(200);

    const { eq } = await import("drizzle-orm");
    const wh = await testDeps.deps.db.query.warehouses.findFirst({
      where: eq(warehouses.id, "wh1"),
    });
    expect(wh?.isDefault).toBe(true);
    expect(wh?.defaultHandoverMethod).toBe("DROP_OFF");
  });

  it("GET /packages/:id/handover-options returns handover options", async () => {
    const testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");

    const app = await buildApp({
      deps: testDeps.deps,
      logger: false,
      testUser: { id: "u1", email: "a@b.c", name: null, role: "ops" },
    });

    const { packages } = await import("@oms/db");
    await testDeps.deps.db.insert(packages).values({
      id: "pkg1",
      shopId: "shop1",
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/handover_time_slots")) {
        return ttsOk({
          can_pickup: true,
          can_drop_off: false,
          pickup_slots: [{ start_time: 1000, end_time: 2000, available: true }],
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/packages/pkg1/handover-options",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.canPickup).toBe(true);
    expect(body.pickupSlots).toHaveLength(1);
  });

  it("PUT /packages/:id/handover sets handover", async () => {
    const testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");

    const app = await buildApp({
      deps: testDeps.deps,
      logger: false,
      testUser: { id: "u1", email: "a@b.c", name: null, role: "ops" },
    });

    const { packages } = await import("@oms/db");
    await testDeps.deps.db.insert(packages).values({
      id: "pkg1",
      shopId: "shop1",
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/handover_time_slots")) {
        return ttsOk({
          can_pickup: true,
          pickup_slots: [{ start_time: 1000, end_time: 2000, available: true }],
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    const res = await app.inject({
      method: "PUT",
      url: "/v1/packages/pkg1/handover",
      payload: { method: "PICKUP", slot: { start: 1000, end: 2000 } },
    });

    expect(res.statusCode).toBe(204);

    const { eq } = await import("drizzle-orm");
    const pkg = await testDeps.deps.db.query.packages.findFirst({
      where: eq(packages.id, "pkg1"),
    });
    expect(pkg?.handoverMethod).toBe("PICKUP");
  });

  it("rejects viewer on ops routes", async () => {
    const testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");

    const app = await buildApp({
      deps: testDeps.deps,
      logger: false,
      testUser: { id: "u1", email: "a@b.c", name: null, role: "viewer" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/shops/shop1/logistics/sync",
    });

    expect(res.statusCode).toBe(403);
  });
});
