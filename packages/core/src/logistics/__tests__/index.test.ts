import { describe, expect, it, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { syncLogistics, listWarehouses, updateWarehouseSettings, getHandoverOptions, setPackageHandover, handlePackageUpdate } from "../index.js";
import { createTestDeps, ttsOk } from "../../testing.js";
import { OmsError } from "../../errors.js";

vi.mock("../../auth/index.js", () => ({
  getShopContext: vi.fn(async (_d, shopId) => ({ shopId, region: "US", accessToken: "t", shopCipher: "c" })),
}));

// Helper to seed initial data
async function seedShop(testDeps: any, shopId: string) {
  const { authorizations, shops } = await import("@oms/db");
  await testDeps.deps.db.insert(authorizations).values({
    id: "auth1",
    sellerName: "Test Seller",
    sellerBaseRegion: "US",
    region: "US",
    userType: 1,
    accessTokenEnc: "encrypted",
    accessTokenExpiresAt: new Date(),
    refreshTokenEnc: "encrypted",
    refreshTokenExpiresAt: new Date(),
  });

  await testDeps.deps.db.insert(shops).values({
    id: shopId,
    name: "Test Shop",
    region: "US",
    cipher: "c",
    authorizationId: "auth1",
    active: true,
  });
}

describe("syncLogistics", () => {
  let testDeps: any;

  beforeEach(async () => {
    testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");
  });

  it("syncs warehouses, delivery options, and shipping providers", async () => {
    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/warehouses") && !url.pathname.includes("/delivery_options")) {
        return ttsOk({
          warehouses: [
            { id: "wh1", name: "Warehouse 1", is_default: true },
            { id: "wh2", name: "Warehouse 2", is_default: false },
          ],
        });
      }
      if (url.pathname.includes("/delivery_options")) {
        return ttsOk({
          delivery_options: [{ id: "do1", name: "Standard Delivery", type: "TIKTOK_SHIPPING" }],
        });
      }
      if (url.pathname.includes("/shipping_providers")) {
        return ttsOk({
          shipping_providers: [{ id: "sp1", name: "DHL" }],
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    const result = await syncLogistics(testDeps.deps, "shop1");
    expect(result.warehouses).toBe(2);
  });

  it("preserves user settings on warehouse upsert", async () => {
    // First insert warehouse with user-set defaults
    const { db } = testDeps.deps;
    const { warehouses } = await import("@oms/db");

    await db.insert(warehouses).values({
      shopId: "shop1",
      id: "wh1",
      name: "Warehouse 1",
      isDefault: true,
      defaultHandoverMethod: "PICKUP",
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/warehouses") && !url.pathname.includes("/delivery_options")) {
        return ttsOk({
          warehouses: [{ id: "wh1", name: "Updated Name", is_default: false }],
        });
      }
      if (url.pathname.includes("/delivery_options")) {
        return ttsOk({ delivery_options: [] });
      }
      return ttsOk({ shipping_providers: [] });
    });

    await syncLogistics(testDeps.deps, "shop1");

    const wh = await db.query.warehouses.findFirst({
      where: eq(warehouses.id, "wh1"),
    });
    expect(wh?.name).toBe("Updated Name");
    expect(wh?.isDefault).toBe(true); // Preserved
    expect(wh?.defaultHandoverMethod).toBe("PICKUP"); // Preserved
  });

  it("deletes warehouses not seen in sync", async () => {
    const { db } = testDeps.deps;
    // Insert old warehouse
    const { warehouses } = await import("@oms/db");
    await db.insert(warehouses).values({
      shopId: "shop1",
      id: "old_wh",
      name: "Old Warehouse",
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/warehouses") && !url.pathname.includes("/delivery_options")) {
        return ttsOk({
          warehouses: [{ id: "wh1", name: "Warehouse 1" }],
        });
      }
      if (url.pathname.includes("/delivery_options")) {
        return ttsOk({ delivery_options: [] });
      }
      return ttsOk({ shipping_providers: [] });
    });

    await syncLogistics(testDeps.deps, "shop1");

    const oldWh = await db.query.warehouses.findFirst({
      where: eq(warehouses.id, "old_wh"),
    });
    expect(oldWh).toBeUndefined();
  });
});

describe("listWarehouses", () => {
  let testDeps: any;

  beforeEach(async () => {
    testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");
  });

  it("returns warehouses with nested options and providers", async () => {
    const { db } = testDeps.deps;
    const { warehouses, deliveryOptions, shippingProviders } = await import("@oms/db");

    await db.insert(warehouses).values({
      shopId: "shop1",
      id: "wh1",
      name: "Warehouse 1",
      isDefault: true,
      defaultHandoverMethod: "PICKUP",
    });

    await db.insert(deliveryOptions).values({
      shopId: "shop1",
      warehouseId: "wh1",
      id: "do1",
      name: "Standard",
    });

    await db.insert(shippingProviders).values({
      shopId: "shop1",
      deliveryOptionId: "do1",
      id: "sp1",
      name: "DHL",
    });

    const result = await listWarehouses(testDeps.deps, "shop1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("wh1");
    expect(result[0].isDefault).toBe(true);
    expect(result[0].deliveryOptions).toHaveLength(1);
    expect(result[0].deliveryOptions[0].providers).toHaveLength(1);
  });
});

describe("updateWarehouseSettings", () => {
  let testDeps: any;

  beforeEach(async () => {
    testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");
  });

  it("updates warehouse settings", async () => {
    const { db } = testDeps.deps;
    const { warehouses } = await import("@oms/db");

    await db.insert(warehouses).values({
      shopId: "shop1",
      id: "wh1",
      name: "Warehouse 1",
    });

    await updateWarehouseSettings(testDeps.deps, "shop1", "wh1", {
      isDefault: true,
      defaultHandoverMethod: "DROP_OFF",
    });

    const wh = await db.query.warehouses.findFirst({
      where: eq(warehouses.id, "wh1"),
    });
    expect(wh?.isDefault).toBe(true);
    expect(wh?.defaultHandoverMethod).toBe("DROP_OFF");
  });

  it("clears default on other warehouses when setting isDefault", async () => {
    const { db } = testDeps.deps;
    const { warehouses } = await import("@oms/db");

    await db.insert(warehouses).values({ shopId: "shop1", id: "wh1", name: "WH1", isDefault: true });
    await db.insert(warehouses).values({ shopId: "shop1", id: "wh2", name: "WH2", isDefault: false });

    await updateWarehouseSettings(testDeps.deps, "shop1", "wh2", { isDefault: true });

    const { and } = await import("drizzle-orm");
    const wh1 = await db.query.warehouses.findFirst({
      where: and(eq(warehouses.shopId, "shop1"), eq(warehouses.id, "wh1")),
    });
    expect(wh1?.isDefault).toBe(false);
  });

  it("throws 404 if warehouse not found", async () => {
    await expect(updateWarehouseSettings(testDeps.deps, "shop1", "missing", {})).rejects.toThrow(OmsError);
  });

  it("throws 400 on invalid handover method", async () => {
    const { db } = testDeps.deps;
    const { warehouses } = await import("@oms/db");

    await db.insert(warehouses).values({
      shopId: "shop1",
      id: "wh1",
      name: "Warehouse 1",
    });

    await expect(
      updateWarehouseSettings(testDeps.deps, "shop1", "wh1", { defaultHandoverMethod: "INVALID" as any }),
    ).rejects.toThrow(OmsError);
  });
});

describe("getHandoverOptions", () => {
  let testDeps: any;

  beforeEach(async () => {
    testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");
  });

  it("returns handover options from API", async () => {
    const { db } = testDeps.deps;
    const { packages } = await import("@oms/db");

    await db.insert(packages).values({
      id: "pkg1",
      shopId: "shop1",
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/handover_time_slots")) {
        return ttsOk({
          can_pickup: true,
          can_drop_off: false,
          pickup_slots: [
            { start_time: 1000, end_time: 2000, available: true },
            { start_time: 3000, end_time: 4000, available: false },
          ],
          drop_off_point_url: null,
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    const result = await getHandoverOptions(testDeps.deps, "pkg1");
    expect(result.canPickup).toBe(true);
    expect(result.canDropOff).toBe(false);
    expect(result.pickupSlots).toHaveLength(2);
    expect(result.pickupSlots[0].available).toBe(true);
    expect(result.pickupSlots[1].available).toBe(false);
  });

  it("throws 404 if package not found", async () => {
    await expect(getHandoverOptions(testDeps.deps, "missing")).rejects.toThrow(OmsError);
  });
});

describe("setPackageHandover", () => {
  let testDeps: any;

  beforeEach(async () => {
    testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");
  });

  it("sets handover method and slot", async () => {
    const { db } = testDeps.deps;
    const { packages } = await import("@oms/db");

    await db.insert(packages).values({
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

    await setPackageHandover(testDeps.deps, "pkg1", { method: "PICKUP", slot: { start: 1000, end: 2000 } });

    const pkg = await db.query.packages.findFirst({
      where: eq(packages.id, "pkg1"),
    });
    expect(pkg?.handoverMethod).toBe("PICKUP");
    expect(pkg?.pickupSlotStart).toBe(1000);
    expect(pkg?.pickupSlotEnd).toBe(2000);
  });

  it("clears slot for DROP_OFF", async () => {
    const { db } = testDeps.deps;
    const { packages } = await import("@oms/db");

    await db.insert(packages).values({
      id: "pkg1",
      shopId: "shop1",
      handoverMethod: "PICKUP",
      pickupSlotStart: 1000,
      pickupSlotEnd: 2000,
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/handover_time_slots")) {
        return ttsOk({
          can_pickup: false,
          can_drop_off: true,
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    await setPackageHandover(testDeps.deps, "pkg1", { method: "DROP_OFF" });

    const pkg = await db.query.packages.findFirst({
      where: eq(packages.id, "pkg1"),
    });
    expect(pkg?.handoverMethod).toBe("DROP_OFF");
    expect(pkg?.pickupSlotStart).toBeNull();
    expect(pkg?.pickupSlotEnd).toBeNull();
  });

  it("rejects unavailable method", async () => {
    const { db } = testDeps.deps;
    const { packages } = await import("@oms/db");

    await db.insert(packages).values({
      id: "pkg1",
      shopId: "shop1",
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/handover_time_slots")) {
        return ttsOk({
          can_pickup: false,
          can_drop_off: false,
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    await expect(setPackageHandover(testDeps.deps, "pkg1", { method: "PICKUP" })).rejects.toThrow(OmsError);
  });

  it("rejects unavailable slot", async () => {
    const { db } = testDeps.deps;
    const { packages } = await import("@oms/db");

    await db.insert(packages).values({
      id: "pkg1",
      shopId: "shop1",
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/handover_time_slots")) {
        return ttsOk({
          can_pickup: true,
          pickup_slots: [{ start_time: 1000, end_time: 2000, available: false }],
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    await expect(
      setPackageHandover(testDeps.deps, "pkg1", { method: "PICKUP", slot: { start: 1000, end: 2000 } }),
    ).rejects.toThrow(OmsError);
  });
});

describe("handlePackageUpdate", () => {
  let testDeps: any;

  beforeEach(async () => {
    testDeps = await createTestDeps();
    await seedShop(testDeps, "shop1");
  });

  it("upserts package and appends event on status change", async () => {
    const { db } = testDeps.deps;
    const { packages, packageEvents } = await import("@oms/db");

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/packages/pkg1")) {
        return ttsOk({
          package_id: "pkg1",
          package_status: "AWAITING_SHIPMENT",
          update_time: 1000,
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    await handlePackageUpdate(testDeps.deps, { shopId: "shop1", packageId: "pkg1" });

    const pkg = await db.query.packages.findFirst({
      where: eq(packages.id, "pkg1"),
    });
    expect(pkg?.status).toBe("AWAITING_SHIPMENT");

    const events = await db.query.packageEvents.findMany({
      where: eq(packageEvents.packageId, "pkg1"),
    });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("AWAITING_SHIPMENT");
  });

  it("ignores older updates", async () => {
    const { db } = testDeps.deps;
    const { packages } = await import("@oms/db");

    await db.insert(packages).values({
      id: "pkg1",
      shopId: "shop1",
      status: "SHIPPED",
      ttsUpdatedAt: 2000,
    });

    testDeps.setFetch((url: URL) => {
      if (url.pathname.includes("/packages/pkg1")) {
        return ttsOk({
          package_id: "pkg1",
          package_status: "AWAITING_SHIPMENT",
          update_time: 1000, // Older than stored 2000
        });
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    await handlePackageUpdate(testDeps.deps, { shopId: "shop1", packageId: "pkg1" });

    const pkg = await db.query.packages.findFirst({
      where: eq(packages.id, "pkg1"),
    });
    expect(pkg?.status).toBe("SHIPPED"); // Unchanged
  });
});
