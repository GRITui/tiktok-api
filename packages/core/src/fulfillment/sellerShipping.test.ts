import { schema } from "@oms/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Queues } from "../queues.js";
import { createTestDeps, ttsErr, ttsOk } from "../testing.js";
import {
  normalizeTrackingNumber, parseCsv, previewTrackingImport, runTrackingImport, shipWithOwnCarrier,
  startTrackingImport, updateSellerTracking,
} from "./sellerShipping.js";

vi.mock("../auth/index.js", () => ({
  getShopContext: vi.fn(async (_d: unknown, shopId: string) => ({ shopId, region: "TH", accessToken: "t", shopCipher: "c" })),
}));
vi.mock("../orders/index.js", () => ({ refreshOrders: vi.fn(async () => {}) }));

let t: Awaited<ReturnType<typeof createTestDeps>>;
const shipped: string[] = [];

async function seed() {
  const far = new Date("2030-01-01");
  await t.deps.db.insert(schema.authorizations).values({
    id: "A1", sellerName: "s", sellerBaseRegion: "TH", userType: 0,
    accessTokenEnc: "x", accessTokenExpiresAt: far, refreshTokenEnc: "x", refreshTokenExpiresAt: far,
  });
  await t.deps.db.insert(schema.shops).values({ id: "S1", name: "Shop", region: "TH", cipher: "c", authorizationId: "A1" });
  await t.deps.db.insert(schema.shippingProviders).values([
    { shopId: "S1", deliveryOptionId: "DO1", id: "KERRY", name: "Kerry Express" },
    { shopId: "S1", deliveryOptionId: "DO1", id: "FLASH", name: "Flash Express" },
    { shopId: "S1", deliveryOptionId: "DO2", id: "OTHER", name: "Other Carrier" },
  ]);
  const pk = async (id: string, orderId: string, shippingType: string) => {
    await t.deps.db.insert(schema.orders).values({
      id: orderId, shopId: "S1", status: "AWAITING_SHIPMENT", currency: "THB", shippingType,
      ttsCreatedAt: new Date(), ttsUpdatedAt: 1, raw: {}, recipientHash: "h1",
    });
    await t.deps.db.insert(schema.packages).values({ id, shopId: "S1", shippingType, deliveryOptionId: "DO1" });
    await t.deps.db.insert(schema.orderPackages).values({ orderId, packageId: id });
  };
  await pk("PS1", "OS1", "SELLER");
  await pk("PS2", "OS2", "SELLER");
  await pk("PT1", "OT1", "TIKTOK");
}

beforeEach(async () => {
  t = await createTestDeps();
  shipped.length = 0;
  t.setFetch(async (url, init) => {
    const p = url.pathname;
    const m = p.match(/^\/fulfillment\/202309\/packages\/([^/]+)\/ship$/);
    if (m) {
      const body = JSON.parse(String(init.body));
      shipped.push(`${m[1]}:${body.self_shipment.shipping_provider_id}:${body.self_shipment.tracking_number}`);
      return ttsOk({});
    }
    if (p.endsWith("/shipping_info/update")) return ttsOk({});
    const d = p.match(/^\/fulfillment\/202309\/packages\/([^/]+)$/);
    if (d) return ttsOk({ package_id: d[1], package_status: "SHIPPED", update_time: 2 });
    throw new Error("unexpected " + p);
  });
  await seed();
});

const input = (over: Partial<Parameters<typeof shipWithOwnCarrier>[1]> = {}) => ({
  packageId: "PS1", actor: "ops@x", idempotencyKey: "key-0001", shippingProviderId: "KERRY", trackingNumber: " kex 12345 ", ...over,
});

describe("shipWithOwnCarrier (#34)", () => {
  it("ships with the carrier's tracking number and records it", async () => {
    const res = await shipWithOwnCarrier(t.deps, input());
    expect(res).toMatchObject({ packageId: "PS1", trackingNumber: "KEX12345", replayed: false });
    expect(shipped).toEqual(["PS1:KERRY:KEX12345"]);
    const [pkg] = await t.deps.db.select().from(schema.packages).where(eq(schema.packages.id, "PS1"));
    expect(pkg).toMatchObject({ trackingNumber: "KEX12345", shippingProviderId: "KERRY", shippingProvider: "Kerry Express" });
    expect(pkg!.shippedAt).not.toBeNull();
  });

  it("replays with the same key instead of shipping twice", async () => {
    await shipWithOwnCarrier(t.deps, input());
    const again = await shipWithOwnCarrier(t.deps, input());
    expect(again.replayed).toBe(true);
    expect(shipped).toHaveLength(1);
  });

  it("rejects carriers not offered for the package's delivery option", async () => {
    await expect(shipWithOwnCarrier(t.deps, input({ shippingProviderId: "OTHER" }))).rejects.toMatchObject({ code: "invalid_provider" });
    expect(shipped).toHaveLength(0);
  });

  it("rejects TikTok Shipping packages and bad tracking numbers", async () => {
    await expect(shipWithOwnCarrier(t.deps, input({ packageId: "PT1" }))).rejects.toMatchObject({ code: "wrong_shipping_type" });
    await expect(shipWithOwnCarrier(t.deps, input({ trackingNumber: "a!" }))).rejects.toMatchObject({ code: "invalid_tracking_number" });
  });

  it("surfaces TikTok errors and allows a retry with the same key", async () => {
    let fail = true;
    t.setFetch(async (url) => {
      if (url.pathname.endsWith("/ship")) {
        if (fail) return ttsErr(21011001, "tracking number already used");
        shipped.push("ok");
        return ttsOk({});
      }
      return ttsOk({ package_id: "PS1", package_status: "SHIPPED" });
    });
    await expect(shipWithOwnCarrier(t.deps, input())).rejects.toMatchObject({ message: expect.stringContaining("tracking number already used") });
    fail = false;
    await expect(shipWithOwnCarrier(t.deps, input())).resolves.toMatchObject({ replayed: false });
    expect(shipped).toEqual(["ok"]);
  });
});

describe("updateSellerTracking (#61)", () => {
  it("needs a shipped package, then updates and audits the previous value", async () => {
    await expect(updateSellerTracking(t.deps, input({ idempotencyKey: "upd-0001" }))).rejects.toMatchObject({ code: "not_shipped" });
    await shipWithOwnCarrier(t.deps, input());
    const res = await updateSellerTracking(t.deps, input({ idempotencyKey: "upd-0002", shippingProviderId: "FLASH", trackingNumber: "TH999999" }));
    expect(res).toMatchObject({ trackingNumber: "TH999999", replayed: false });
    expect(res).not.toHaveProperty("previous");
    const [pkg] = await t.deps.db.select().from(schema.packages).where(eq(schema.packages.id, "PS1"));
    expect(pkg).toMatchObject({ trackingNumber: "TH999999", shippingProviderId: "FLASH" });
    const audits = await t.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "update_tracking"));
    expect(JSON.stringify(audits.at(-1)!.response)).toContain("KEX12345");
  });

  it("rejects a no-op change", async () => {
    await shipWithOwnCarrier(t.deps, input());
    await expect(updateSellerTracking(t.deps, input({ idempotencyKey: "upd-0003" }))).rejects.toMatchObject({ code: "no_change" });
  });
});

describe("tracking CSV import (#60)", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n\r\nx,y,z')).toEqual([["a", "b, c", 'say "hi"'], ["x", "y", "z"]]);
    expect(normalizeTrackingNumber("ab-12 34")).toBe("AB-1234");
  });

  it("previews: resolves order ids and carrier names, reports each problem", async () => {
    const csv = [
      "order_or_package_id,shipping_provider,tracking_number",
      "OS1,kerry express,KEX00001",      // order id + carrier name (case-insensitive)
      "PS2,FLASH,FL0002",                // package id + carrier id
      "PT1,KERRY,KEX3333",               // TikTok shipping package
      "NOPE,KERRY,KEX4444",              // unknown
      "PS2,KERRY,KEX5555",               // duplicate package
      "PS1,KERRY,a!",                    // bad tracking number (and duplicate of row 1)
    ].join("\n");
    const { rows, ok, errors } = await previewTrackingImport(t.deps, csv);
    expect(ok).toBe(2);
    expect(errors).toBe(4);
    expect(rows[0]).toMatchObject({ status: "ok", packageId: "PS1", shippingProviderId: "KERRY", trackingNumber: "KEX00001" });
    expect(rows[1]).toMatchObject({ status: "ok", packageId: "PS2", shippingProviderId: "FLASH", trackingNumber: "FL0002" });
    expect(rows[2]!.error).toMatch(/TikTok Shipping/);
    expect(rows[3]!.error).toMatch(/No order or package/);
    expect(rows[4]!.error).toMatch(/more than once/);
    expect(rows[5]!.error).toMatch(/more than once/);
  });

  it("imports valid rows as a job and ships each once, even when rerun", async () => {
    const csv = "OS1,Kerry Express,KEX10001\nPS2,FLASH,FL20002\nPT1,KERRY,KEX30003\n";
    const { jobId, accepted, rejected } = await startTrackingImport(t.deps, { csv, actor: "ops@x" });
    expect(accepted).toBe(2);
    expect(rejected).toHaveLength(1);
    expect(t.queues.jobs.at(-1)).toMatchObject({ queue: Queues.trackingImport, data: { jobId } });

    await runTrackingImport(t.deps, jobId);
    await runTrackingImport(t.deps, jobId);
    expect(shipped.sort()).toEqual(["PS1:KERRY:KEX10001", "PS2:FLASH:FL20002"]);
    const [job] = await t.deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({ status: "succeeded", succeeded: 2, failed: 0 });
  });

  it("rejects carriers that are not offered for the package", async () => {
    const { rows } = await previewTrackingImport(t.deps, "PS1,Other Carrier,OTH66666");
    expect(rows[0]!.error).toMatch(/not available/);
  });

  it("refuses a file with no valid rows", async () => {
    await expect(startTrackingImport(t.deps, { csv: "PT1,KERRY,KEX30003", actor: "ops@x" })).rejects.toMatchObject({ code: "nothing_to_import" });
  });
});
