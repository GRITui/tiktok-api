import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDeps, ttsOk, ttsErr } from "../testing.js";
import {
  recordAudit,
  withIdempotency,
  assertShippable,
  shipPackage,
  startBatchShip,
  runBatchShip,
  startLabelJob,
  runLabelJob,
  setDocumentFetcher,
} from "./index.js";
import { schema } from "@oms/db";
import { eq } from "drizzle-orm";
import { OmsError } from "../errors.js";
import { PDFDocument } from "pdf-lib";

// Mock dependencies
vi.mock("../auth/index.js", () => ({
  getShopContext: vi.fn(async (_d, shopId) => ({
    shopId,
    region: "US",
    accessToken: "test-token",
    shopCipher: "test-cipher",
  })),
}));

vi.mock("../orders/index.js", () => ({
  refreshOrders: vi.fn(async () => {}),
}));

describe("fulfillment", () => {
  let testEnv: Awaited<ReturnType<typeof createTestDeps>>;

  beforeEach(async () => {
    testEnv = await createTestDeps();
  });

  describe("recordAudit", () => {
    it("inserts an audit log entry", async () => {
      const { deps } = testEnv;

      await recordAudit(deps, {
        actor: "test@example.com",
        shopId: "shop-123",
        action: "ship_package",
        targetId: "pkg-123",
        ok: true,
        ttsRequestId: "req-456",
      });

      const entries = await deps.db.select().from(schema.auditLog);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actor: "test@example.com",
        shopId: "shop-123",
        action: "ship_package",
        targetId: "pkg-123",
        ok: true,
        ttsRequestId: "req-456",
      });
    });
  });

  describe("withIdempotency", () => {
    it("executes fn once and stores result", async () => {
      const { deps } = testEnv;

      const fn = vi.fn(async () => ({ result: { test: "value" }, ttsRequestId: "req-123" }));

      const res1 = await withIdempotency(deps, { key: "key-1", action: "test", targetId: "id-1", actor: "user" }, fn);

      expect(res1).toEqual({ result: { test: "value" }, replayed: false });
      expect(fn).toHaveBeenCalledTimes(1);

      const res2 = await withIdempotency(deps, { key: "key-1", action: "test", targetId: "id-1", actor: "user" }, fn);

      expect(res2).toEqual({ result: { test: "value" }, replayed: true });
      expect(fn).toHaveBeenCalledTimes(1); // Not called again
    });

    it("throws 409 for concurrent calls", async () => {
      const { deps } = testEnv;

      const fn = vi.fn(async () => new Promise((r) => setTimeout(r, 100)).then(() => ({ result: "ok" })));

      // Start first call
      const promise1 = withIdempotency(deps, { key: "key-1", action: "test", targetId: "id-1", actor: "user" }, fn);

      // Try concurrent call
      await new Promise((r) => setTimeout(r, 10));
      const promise2 = withIdempotency(deps, { key: "key-1", action: "test", targetId: "id-1", actor: "user" }, fn).catch((e) => e);

      const res1 = await promise1;
      const res2 = await promise2;

      expect(res1).toEqual({ result: "ok", replayed: false });
      expect(res2).toBeInstanceOf(OmsError);
      expect(res2.code).toBe("in_progress");
      expect(res2.status).toBe(409);
    });

    it("rejects key mismatch", async () => {
      const { deps } = testEnv;

      const fn1 = vi.fn(async () => ({ result: "ok" }));
      const fn2 = vi.fn(async () => ({ result: "ok" }));

      await withIdempotency(deps, { key: "key-1", action: "ship", targetId: "pkg-1", actor: "user" }, fn1);

      const err = await withIdempotency(
        deps,
        { key: "key-1", action: "ship", targetId: "pkg-2", actor: "user" }, // Different targetId
        fn2,
      ).catch((e) => e);

      expect(err).toBeInstanceOf(OmsError);
      expect(err.code).toBe("idempotency_key_mismatch");
      expect(err.status).toBe(422);
    });

    it("allows retry on failed status", async () => {
      const { deps } = testEnv;

      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("First call fails");
        }
        return { result: "ok" };
      });

      const err = await withIdempotency(
        deps,
        { key: "key-1", action: "test", targetId: "id-1", actor: "user" },
        fn,
      ).catch((e) => e);

      expect(err).toBeInstanceOf(Error);

      // Retry
      const res = await withIdempotency(deps, { key: "key-1", action: "test", targetId: "id-1", actor: "user" }, fn);
      expect(res).toEqual({ result: "ok", replayed: false });
    });

    it("records audit on success and failure", async () => {
      const { deps } = testEnv;

      const fn1 = vi.fn(async () => ({ result: "ok" }));
      await withIdempotency(deps, { key: "k1", action: "test", targetId: "t1", actor: "user@x.y", shopId: "shop-1" }, fn1);

      const fn2 = vi.fn(async () => {
        throw new Error("Test error");
      });
      await withIdempotency(deps, { key: "k2", action: "test", targetId: "t2", actor: "user@x.y", shopId: "shop-1" }, fn2).catch(
        () => {},
      );

      const entries = await deps.db.select().from(schema.auditLog);
      expect(entries).toHaveLength(2);
      expect(entries[0].ok).toBe(true);
      expect(entries[1].ok).toBe(false);
    });
  });

  describe("assertShippable", () => {
    beforeEach(async () => {
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

      await deps.db.insert(schema.shops).values({ id: "shop-1", name: "Test Shop", region: "US", cipher: "c", authorizationId: "auth-1" });

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
      });

      await deps.db.insert(schema.orderPackages).values({ orderId: "order-1", packageId: "pkg-1" });
    });

    it("passes for shippable package", async () => {
      const { deps } = testEnv;
      await expect(assertShippable(deps, "pkg-1")).resolves.toBeUndefined();
    });

    it("throws 404 for nonexistent package", async () => {
      const { deps } = testEnv;
      const err = await assertShippable(deps, "nonexistent").catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);
      expect(err.code).toBe("not_found");
    });

    it("throws for already shipped package", async () => {
      const { deps } = testEnv;
      await deps.db.update(schema.packages).set({ shippedAt: new Date() }).where(eq(schema.packages.id, "pkg-1"));

      const err = await assertShippable(deps, "pkg-1").catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);
      expect(err.code).toBe("not_shippable");
      expect(err.details).toMatchObject({ reason: "already_shipped" });
    });

    it("throws for order with wrong status", async () => {
      const { deps } = testEnv;
      await deps.db.update(schema.orders).set({ status: "DELIVERED" }).where(eq(schema.orders.id, "order-1"));

      const err = await assertShippable(deps, "pkg-1").catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);
      expect(err.code).toBe("not_shippable");
      expect(err.details).toMatchObject({ reason: "status_DELIVERED" });
    });

    it("throws for FBT order", async () => {
      const { deps } = testEnv;
      await deps.db.update(schema.orders).set({ fulfillmentType: "FULFILLMENT_BY_TIKTOK" }).where(eq(schema.orders.id, "order-1"));

      const err = await assertShippable(deps, "pkg-1").catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);
      expect(err.code).toBe("not_shippable");
      expect(err.details).toMatchObject({ reason: "fbt" });
    });

    it("throws for address changed", async () => {
      const { deps } = testEnv;
      await deps.db.update(schema.packages).set({ shippedRecipientHash: "old-hash" }).where(eq(schema.packages.id, "pkg-1"));

      const err = await assertShippable(deps, "pkg-1").catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);
      expect(err.code).toBe("not_shippable");
      expect(err.details).toMatchObject({ reason: "address_changed" });
    });
  });

  describe("shipPackage", () => {
    beforeEach(async () => {
      const { deps } = testEnv;
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

      await deps.db.insert(schema.shops).values({ id: "shop-1", name: "Test Shop", region: "US", cipher: "c", authorizationId: "auth-1" });
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
      await deps.db.insert(schema.orderPackages).values({ orderId: "order-1", packageId: "pkg-1" });
    });

    it("ships a package successfully", async () => {
      const { deps, setFetch } = testEnv;

      setFetch((url) => {
        if (url.pathname.includes("/fulfillment/") && url.pathname.includes("/packages/pkg-1/ship")) {
          return ttsOk({});
        }
        if (url.pathname.includes("/fulfillment/") && url.pathname.includes("/packages/pkg-1")) {
          return ttsOk({
            package_id: "pkg-1",
            package_status: "SHIPPED",
            tracking_number: "TRK-123",
            shipping_provider_id: "ups",
            shipping_provider_name: "UPS",
          });
        }
        throw new Error(`Unexpected call: ${url.pathname}`);
      });

      const result = await shipPackage(deps, {
        packageId: "pkg-1",
        actor: "user@x.y",
        idempotencyKey: "key-1",
        handoverMethod: "DROP_OFF",
      });

      expect(result).toMatchObject({
        packageId: "pkg-1",
        status: "SHIPPED",
        trackingNumber: "TRK-123",
        replayed: false,
      });

      const pkg = await deps.db.select().from(schema.packages).where(eq(schema.packages.id, "pkg-1"));
      expect(pkg[0]).toMatchObject({
        status: "SHIPPED",
        trackingNumber: "TRK-123",
        shippingProvider: "UPS",
        handoverMethod: "DROP_OFF",
        shippedAt: expect.any(Date),
      });
    });

    it("uses warehouse default handover method", async () => {
      const { deps, setFetch } = testEnv;

      let capturedHandoverMethod: string | undefined;

      setFetch((url, init) => {
        if (url.pathname.includes("/ship") && init.method === "POST") {
          const body = JSON.parse(init.body as string);
          capturedHandoverMethod = body.handover_method;
          return ttsOk({});
        }
        if (url.pathname.includes("/packages/pkg-1")) {
          return ttsOk({ package_id: "pkg-1", package_status: "SHIPPED" });
        }
        throw new Error(`Unexpected call: ${url.pathname}`);
      });

      await shipPackage(deps, {
        packageId: "pkg-1",
        actor: "user@x.y",
        idempotencyKey: "key-1",
      });

      expect(capturedHandoverMethod).toBe("DROP_OFF");
    });
  });

  describe("startBatchShip and runBatchShip", () => {
    beforeEach(async () => {
      const { deps } = testEnv;
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

      await deps.db.insert(schema.shops).values({ id: "shop-1", name: "Test Shop", region: "US", cipher: "c", authorizationId: "auth-1" });
      await deps.db.insert(schema.warehouses).values({
        shopId: "shop-1",
        id: "wh-1",
        name: "Main Warehouse",
        isDefault: true,
        defaultHandoverMethod: "DROP_OFF",
      });

      for (let i = 1; i <= 3; i++) {
        await deps.db.insert(schema.orders).values({
          id: `order-${i}`,
          shopId: "shop-1",
          status: "AWAITING_SHIPMENT",
          currency: "USD",
          ttsCreatedAt: new Date(),
          ttsUpdatedAt: 100,
          raw: {},
          recipientHash: `hash-${i}`,
        });
        await deps.db.insert(schema.packages).values({
          id: `pkg-${i}`,
          shopId: "shop-1",
          status: "READY_TO_SHIP",
          shippingType: "TIKTOK",
          warehouseId: "wh-1",
        });
        await deps.db.insert(schema.orderPackages).values({ orderId: `order-${i}`, packageId: `pkg-${i}` });
      }
    });

    it("creates a batch ship job", async () => {
      const { deps } = testEnv;

      const { jobId } = await startBatchShip(deps, {
        packageIds: ["pkg-1", "pkg-2"],
        actor: "user@x.y",
      });

      expect(jobId).toBeDefined();

      const jobs = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        type: "batch_ship",
        status: "queued",
        total: 2,
      });

      const items = await deps.db.select().from(schema.jobItems).where(eq(schema.jobItems.jobId, jobId));
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ status: "pending", targetId: "pkg-1" });
    });

    it("rejects invalid packageIds", async () => {
      const { deps } = testEnv;

      let err = await startBatchShip(deps, { packageIds: [], actor: "user" }).catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);

      err = await startBatchShip(deps, { packageIds: Array(501).fill("pkg"), actor: "user" }).catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);

      err = await startBatchShip(deps, { packageIds: ["pkg-1", "pkg-1"], actor: "user" }).catch((e) => e);
      expect(err).toBeInstanceOf(OmsError);
    });

    it("processes batch ship job", async () => {
      const { deps, setFetch } = testEnv;

      setFetch((url, init) => {
        if (url.pathname.includes("/packages/ship") && init.method === "POST") {
          return ttsOk({});
        }
        if (url.pathname.includes("/packages/pkg-")) {
          const match = url.pathname.match(/pkg-(\d)/);
          const num = match ? match[1] : "1";
          return ttsOk({
            package_id: `pkg-${num}`,
            package_status: "SHIPPED",
            tracking_number: `TRK-${num}`,
          });
        }
        throw new Error(`Unexpected call: ${url.pathname}`);
      });

      const { jobId } = await startBatchShip(deps, {
        packageIds: ["pkg-1", "pkg-2", "pkg-3"],
        actor: "user@x.y",
      });

      await runBatchShip(deps, jobId);

      const job = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job[0]).toMatchObject({
        status: "succeeded",
        succeeded: 3,
        failed: 0,
      });

      const items = await deps.db.select().from(schema.jobItems).where(eq(schema.jobItems.jobId, jobId));
      expect(items.filter((i) => i.status === "succeeded")).toHaveLength(3);
    });
  });

  describe("startLabelJob and runLabelJob", () => {
    beforeEach(async () => {
      const { deps } = testEnv;
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

      await deps.db.insert(schema.shops).values({ id: "shop-1", name: "Test Shop", region: "US", cipher: "c", authorizationId: "auth-1" });
      await deps.db.insert(schema.packages).values({
        id: "pkg-1",
        shopId: "shop-1",
        status: "SHIPPED",
        shippingType: "TIKTOK",
        trackingNumber: "TRK-123",
        shippedAt: new Date(),
      });
      await deps.db.insert(schema.packages).values({
        id: "pkg-2",
        shopId: "shop-1",
        status: "READY_TO_SHIP",
      });
    });

    it("creates a label job", async () => {
      const { deps } = testEnv;

      const { jobId } = await startLabelJob(deps, {
        packageIds: ["pkg-1"],
        documentType: "SHIPPING_LABEL",
        actor: "user@x.y",
      });

      expect(jobId).toBeDefined();

      const jobs = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        type: "labels",
        status: "queued",
        total: 1,
      });
    });

    it("processes label job with PDF download", async () => {
      const { deps, setFetch } = testEnv;

      setFetch((url) => {
        if (url.pathname.includes("/shipping_documents")) {
          return ttsOk({ doc_url: "https://example.com/label.pdf" });
        }
        throw new Error(`Unexpected call: ${url.pathname}`);
      });

      // Mock PDF fetch - create a proper PDF with content
      const testPdf = await PDFDocument.create();
      const page = testPdf.addPage([600, 800]);
      page.drawText("Test PDF");
      const pdfBytes = await testPdf.save();

      setDocumentFetcher(async (_url: string) => pdfBytes.buffer);

      const { jobId } = await startLabelJob(deps, {
        packageIds: ["pkg-1"],
        documentType: "SHIPPING_LABEL",
        actor: "user@x.y",
      });

      await runLabelJob(deps, jobId);

      const job = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job[0]).toMatchObject({
        status: "succeeded",
        succeeded: 1,
        failed: 0,
      });

      expect(job[0]?.result).toMatchObject({
        filePath: expect.stringContaining(`labels/${jobId}.pdf`),
        contentType: "application/pdf",
      });
    });

    it("marks unshipped packages as failed", async () => {
      const { deps } = testEnv;

      const { jobId } = await startLabelJob(deps, {
        packageIds: ["pkg-2"],
        documentType: "SHIPPING_LABEL",
        actor: "user@x.y",
      });

      await runLabelJob(deps, jobId);

      const job = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job[0]).toMatchObject({
        status: "failed",
        succeeded: 0,
        failed: 1,
      });

      const items = await deps.db.select().from(schema.jobItems).where(eq(schema.jobItems.jobId, jobId));
      expect(items[0]).toMatchObject({
        status: "failed",
        error: expect.stringContaining("not shipped"),
      });
    });
  });
});
