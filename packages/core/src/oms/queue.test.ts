import { schema } from "@oms/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDeps } from "../testing.js";
import { getFulfillmentQueue, listOrders } from "./index.js";

const H = 3600_000;
let t: Awaited<ReturnType<typeof createTestDeps>>;
const now = new Date("2026-10-06T00:00:00Z");

async function seed() {
  const far = new Date("2030-01-01");
  await t.deps.db.insert(schema.authorizations).values({
    id: "a1", sellerName: "s", sellerBaseRegion: "TH", userType: 0,
    accessTokenEnc: "x", accessTokenExpiresAt: far, refreshTokenEnc: "x", refreshTokenExpiresAt: far,
  });
  await t.deps.db.insert(schema.shops).values({ id: "S1", name: "Shop", region: "TH", cipher: "c", authorizationId: "a1" });
  // [order, rts offset hours | null, fulfillmentType]
  const specs: [string, number | null, string | null][] = [
    ["O1", -2, null], // overdue, fulfillment type unset (must NOT be treated as FBT)
    ["O2", 5, "FULFILLMENT_BY_SELLER"], // lt24h
    ["O3", 48, null], // later
    ["O4", null, null], // later (no SLA)
    ["O5", 1, "FULFILLMENT_BY_TIKTOK"], // FBT: excluded
  ];
  for (const [id, off, ft] of specs) {
    await t.deps.db.insert(schema.orders).values({
      id, shopId: "S1", status: "AWAITING_SHIPMENT", currency: "THB", fulfillmentType: ft,
      rtsSlaAt: off == null ? null : new Date(now.getTime() + off * H),
      ttsCreatedAt: now, ttsUpdatedAt: 1, raw: {},
    });
    await t.deps.db.insert(schema.orderLineItems).values([
      { id: `${id}-L1`, orderId: id, productId: "p", skuId: "k1", sellerSku: "SKU-A", productName: "A", salePrice: "1" },
      { id: `${id}-L2`, orderId: id, productId: "p", skuId: "k2", sellerSku: "SKU-A", productName: "A", salePrice: "1" },
    ]);
    await t.deps.db.insert(schema.packages).values({ id: `P-${id}`, shopId: "S1" });
    await t.deps.db.insert(schema.orderPackages).values({ orderId: id, packageId: `P-${id}` });
    await t.deps.db.insert(schema.packageLineItems).values([
      { packageId: `P-${id}`, lineItemId: `${id}-L1` },
      { packageId: `P-${id}`, lineItemId: `${id}-L2` },
    ]);
  }
}

beforeEach(async () => {
  t = await createTestDeps();
  t.setNow(now);
  await seed();
});

describe("getFulfillmentQueue", () => {
  it("includes orders with no fulfillment type, excludes FBT, sorts by SLA with nulls last", async () => {
    const page = await getFulfillmentQueue(t.deps, {});
    expect(page.items.map((i) => i.packageId)).toEqual(["P-O1", "P-O2", "P-O3", "P-O4"]);
    expect(page.items.map((i) => i.slaBucket)).toEqual(["overdue", "lt24h", "later", "later"]);
    expect(page.items[0]!.itemCount).toBe(2);
    expect(page.items[0]!.skus).toEqual(["SKU-A"]);
    expect(page.counts).toEqual({ overdue: 1, lt24h: 1, later: 2 });
  });

  it("pages forward with the cursor without gaps or repeats, including the NULL-SLA tail", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await getFulfillmentQueue(t.deps, { limit: 1, cursor });
      seen.push(...page.items.map((i) => i.packageId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(["P-O1", "P-O2", "P-O3", "P-O4"]);
  });

  it("keeps all bucket counts when filtering by SLA bucket", async () => {
    const page = await getFulfillmentQueue(t.deps, { sla: "later" });
    expect(page.items.map((i) => i.packageId)).toEqual(["P-O3", "P-O4"]);
    expect(page.counts).toEqual({ overdue: 1, lt24h: 1, later: 2 });
  });

  it("drops shipped packages", async () => {
    const { eq } = await import("drizzle-orm");
    await t.deps.db.update(schema.packages).set({ shippedAt: now }).where(eq(schema.packages.id, "P-O1"));
    const page = await getFulfillmentQueue(t.deps, {});
    expect(page.items.map((i) => i.packageId)).not.toContain("P-O1");
    expect(page.counts.overdue).toBe(0);
  });
});

describe("listOrders itemCount", () => {
  it("counts line items per order", async () => {
    const page = await listOrders(t.deps, {}, { id: "u", email: "u@x", name: null, role: "ops" });
    expect(page.items.find((o) => o.id === "O1")!.itemCount).toBe(2);
  });
});
