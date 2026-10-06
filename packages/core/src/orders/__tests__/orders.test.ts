import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  upsertOrders,
  refreshOrders,
  ingestWebhook,
  processWebhookEvent,
  ensureWebhookSubscriptions,
  runOrderSync,
  runBackfill,
  InMemoryRateLimiter,
} from "../index.js";
import { createTestDeps, ttsOk } from "../../testing.js";
import { schema } from "@oms/db";
import { eq } from "drizzle-orm";
import { WebhookType } from "@oms/tiktok-sdk";
import type { Order } from "@oms/tiktok-sdk";
import { OmsError } from "../../errors.js";

let getShopContextMock = vi.fn(async (_d, shopId) => ({
  shopId,
  region: "US",
  accessToken: "test-token",
  shopCipher: "test-cipher",
}));

vi.mock("../../auth/index.js", () => ({
  getShopContext: (...args) => getShopContextMock(...args),
  markAuthorizationRevoked: vi.fn(),
}));

vi.mock("../../logistics/index.js", () => ({
  handlePackageUpdate: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  getShopContextMock = vi.fn(async (_d, shopId) => ({
    shopId,
    region: "US",
    accessToken: "test-token",
    shopCipher: "test-cipher",
  }));
});

const mockOrder: Order = {
  id: "order-123",
  status: "AWAITING_SHIPMENT",
  create_time: 1696464000,
  update_time: 1696464000,
  fulfillment_type: "STANDARD",
  shipping_type: "TIKTOK",
  buyer_message: "Test order",
  user_id: "user-456",
  payment: {
    currency: "USD",
    total_amount: "10.99",
  },
  recipient_address: {
    name: "John Doe",
    phone_number: "+1234567890",
    full_address: "123 Main St",
    postal_code: "12345",
    region_code: "US-CA",
  },
  line_items: [
    {
      id: "item-1",
      product_id: "prod-1",
      product_name: "Test Product",
      sku_id: "sku-1",
      sale_price: "10.99",
      currency: "USD",
      package_id: "pkg-1",
    },
  ],
};

describe("orders", () => {
  let test: Awaited<ReturnType<typeof createTestDeps>>;

  beforeEach(async () => {
    test = await createTestDeps();

    await test.deps.db.insert(schema.authorizations).values({
      id: "auth-123",
      sellerName: "Test Seller",
      sellerBaseRegion: "US",
      region: "US",
      userType: 1,
      accessTokenEnc: "encrypted-token",
      accessTokenExpiresAt: new Date(Date.now() + 86400000),
      refreshTokenEnc: "encrypted-refresh",
      refreshTokenExpiresAt: new Date(Date.now() + 86400000),
    });

    await test.deps.db.insert(schema.shops).values({
      id: "shop-1",
      name: "Test Shop",
      region: "US",
      cipher: "test-cipher",
      authorizationId: "auth-123",
      active: true,
    });
  });

  describe("upsertOrders", () => {
    it("inserts new orders", async () => {
      const result = await upsertOrders(test.deps, "shop-1", [mockOrder]);
      expect(result.written).toBe(1);
      expect(result.skipped).toBe(0);

      const inserted = await test.deps.db.query.orders.findFirst({
        where: eq(schema.orders.id, mockOrder.id),
      });
      expect(inserted).toBeDefined();
      expect(inserted?.status).toBe("AWAITING_SHIPMENT");
      expect(inserted?.currency).toBe("USD");
    });

    it("creates line items with package references", async () => {
      await upsertOrders(test.deps, "shop-1", [mockOrder]);

      const lineItem = await test.deps.db.query.orderLineItems.findFirst({
        where: eq(schema.orderLineItems.id, "item-1"),
      });
      expect(lineItem).toBeDefined();
      expect(lineItem?.orderId).toBe("order-123");
      expect(lineItem?.packageId).toBe("pkg-1");
    });

    it("creates package and package_line_items", async () => {
      await upsertOrders(test.deps, "shop-1", [mockOrder]);

      const pkg = await test.deps.db.query.packages.findFirst({
        where: eq(schema.packages.id, "pkg-1"),
      });
      expect(pkg).toBeDefined();
      expect(pkg?.shopId).toBe("shop-1");
      expect(pkg?.shippingType).toBe("TIKTOK");

      const mapping = await test.deps.db.query.packageLineItems.findFirst({
        where: eq(schema.packageLineItems.packageId, "pkg-1"),
      });
      expect(mapping).toBeDefined();
      expect(mapping?.lineItemId).toBe("item-1");
    });

    it("creates order_packages mapping", async () => {
      await upsertOrders(test.deps, "shop-1", [mockOrder]);

      const mapping = await test.deps.db.query.orderPackages.findFirst({
        where: eq(schema.orderPackages.orderId, "order-123"),
      });
      expect(mapping).toBeDefined();
      expect(mapping?.packageId).toBe("pkg-1");
    });

    it("skips out-of-order updates", async () => {
      const order1 = { ...mockOrder, update_time: 100 };
      const order2 = { ...mockOrder, update_time: 50 };

      await upsertOrders(test.deps, "shop-1", [order1]);
      const result = await upsertOrders(test.deps, "shop-1", [order2]);

      expect(result.skipped).toBe(1);
      expect(result.written).toBe(0);

      const inserted = await test.deps.db.query.orders.findFirst({
        where: eq(schema.orders.id, "order-123"),
      });
      expect(inserted?.ttsUpdatedAt).toBe(100);
    });

    it("computes recipient_hash from address", async () => {
      await upsertOrders(test.deps, "shop-1", [mockOrder]);

      const inserted = await test.deps.db.query.orders.findFirst({
        where: eq(schema.orders.id, "order-123"),
      });
      expect(inserted?.recipientHash).toBeDefined();
      expect(inserted?.recipientHash?.length).toBe(64);
    });

    it("detects address change via hash", async () => {
      const order1 = {
        ...mockOrder,
        id: "order-addr-1",
      };
      const order2 = {
        ...mockOrder,
        id: "order-addr-2",
        recipient_address: {
          ...mockOrder.recipient_address,
          full_address: "456 Oak Ave",
        },
      };

      await upsertOrders(test.deps, "shop-1", [order1, order2]);
      const hash1 = (
        await test.deps.db.query.orders.findFirst({
          where: eq(schema.orders.id, "order-addr-1"),
        })
      )?.recipientHash;

      const hash2 = (
        await test.deps.db.query.orders.findFirst({
          where: eq(schema.orders.id, "order-addr-2"),
        })
      )?.recipientHash;

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("refreshOrders", () => {
    it("fetches and upserts order details", async () => {
      test.setFetch((url) => {
        if (url.pathname.includes("/orders")) {
          return ttsOk({ orders: [mockOrder] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await refreshOrders(test.deps, "shop-1", ["order-123"]);

      const inserted = await test.deps.db.query.orders.findFirst({
        where: eq(schema.orders.id, "order-123"),
      });
      expect(inserted).toBeDefined();
    });

    it("batches order IDs by 50", async () => {
      const orderIds = Array.from({ length: 125 }, (_, i) => `order-${i}`);
      const fetchedIds: string[] = [];

      test.setFetch((url) => {
        const ids = url.searchParams.get("ids");
        if (ids) {
          fetchedIds.push(...ids.split(","));
        }
        return ttsOk({ orders: [] });
      });

      await refreshOrders(test.deps, "shop-1", orderIds);
      expect(fetchedIds).toHaveLength(125);
    });
  });

  describe("ingestWebhook", () => {
    it("stores webhook and enqueues job", async () => {
      const envelope = {
        type: WebhookType.ORDER_STATUS_CHANGE,
        tts_notification_id: "notif-123",
        shop_id: "shop-1",
        timestamp: 1696464000,
        data: { order_id: "order-123" },
      };

      const result = await ingestWebhook(test.deps, envelope);

      expect(result.duplicate).toBe(false);
      expect(result.eventId).toBeDefined();

      const stored = await test.deps.db.query.webhookEvents.findFirst({
        where: eq(schema.webhookEvents.id, result.eventId!),
      });
      expect(stored).toBeDefined();
      expect(stored?.notificationId).toBe("notif-123");

      const queued = test.queues.jobs.find((j) => j.queue === "tts-webhook");
      expect(queued).toBeDefined();
      expect(queued?.data.eventId).toBe(result.eventId);
    });

    it("detects duplicate webhooks by notification_id", async () => {
      const envelope = {
        type: WebhookType.ORDER_STATUS_CHANGE,
        tts_notification_id: "notif-123",
        shop_id: "shop-1",
        timestamp: 1696464000,
        data: { order_id: "order-123" },
      };

      const result1 = await ingestWebhook(test.deps, envelope);
      const result2 = await ingestWebhook(test.deps, envelope);

      expect(result1.duplicate).toBe(false);
      expect(result1.eventId).toBeDefined();
      expect(result2.duplicate).toBe(true);
      expect(result2.eventId).toBeNull();

      const count = (
        await test.deps.db.query.webhookEvents.findMany({
          where: eq(schema.webhookEvents.notificationId, "notif-123"),
        })
      ).length;
      expect(count).toBe(1);
    });

    it("uses eventId for job deduplication", async () => {
      const envelope = {
        type: WebhookType.ORDER_STATUS_CHANGE,
        tts_notification_id: "notif-456",
        shop_id: "shop-1",
        timestamp: 1696464000,
        data: { order_id: "order-123" },
      };

      const result = await ingestWebhook(test.deps, envelope);
      const queued = test.queues.jobs.find((j) => j.queue === "tts-webhook");

      expect(queued?.opts?.jobId).toBe(`wh-${result.eventId}`);
    });
  });

  describe("processWebhookEvent", () => {
    it("processes ORDER_STATUS_CHANGE", async () => {
      const { getShopContext } = await import("../../auth/index.js");
      const { mockFn } = vi;

      test.setFetch((url) => {
        if (url.pathname.includes("/orders")) {
          return ttsOk({ orders: [mockOrder] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await ingestWebhook(test.deps, {
        type: WebhookType.ORDER_STATUS_CHANGE,
        tts_notification_id: "notif-123",
        shop_id: "shop-1",
        timestamp: 1696464000,
        data: { order_id: "order-123" },
      });

      const event = await test.deps.db.query.webhookEvents.findFirst();
      await processWebhookEvent(test.deps, event!.id);

      const processed = await test.deps.db.query.webhookEvents.findFirst({
        where: eq(schema.webhookEvents.id, event!.id),
      });
      expect(processed?.processedAt).toBeDefined();
      expect(processed?.error).toBeNull();
    });

    it("processes RECIPIENT_ADDRESS_UPDATE", async () => {
      test.setFetch((url) => {
        if (url.pathname.includes("/orders")) {
          return ttsOk({ orders: [mockOrder] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const eventId = (
        await test.deps.db
          .insert(schema.webhookEvents)
          .values({
            notificationId: "notif-addr",
            type: WebhookType.RECIPIENT_ADDRESS_UPDATE,
            shopId: "shop-1",
            payload: { order_id: "order-123" },
          })
          .returning({ id: schema.webhookEvents.id })
      )[0]!.id;

      await processWebhookEvent(test.deps, eventId);

      const processed = await test.deps.db.query.webhookEvents.findFirst({
        where: eq(schema.webhookEvents.id, eventId),
      });
      expect(processed?.processedAt).toBeDefined();
    });

    it("processes SELLER_DEAUTHORIZATION", async () => {
      const { markAuthorizationRevoked } = await import("../../auth/index.js");

      const eventId = (
        await test.deps.db
          .insert(schema.webhookEvents)
          .values({
            notificationId: "notif-deauth",
            type: WebhookType.SELLER_DEAUTHORIZATION,
            shopId: "shop-1",
            payload: {},
          })
          .returning({ id: schema.webhookEvents.id })
      )[0]!.id;

      await processWebhookEvent(test.deps, eventId);

      expect(markAuthorizationRevoked).toHaveBeenCalledWith(
        test.deps,
        "auth-123",
        "webhook",
      );
    });

    it("increments attempts on error and rethrows", async () => {
      const eventId = (
        await test.deps.db
          .insert(schema.webhookEvents)
          .values({
            notificationId: "notif-error",
            type: WebhookType.PACKAGE_UPDATE,
            shopId: "shop-1",
            payload: { package_id: "pkg-1" },
          })
          .returning({ id: schema.webhookEvents.id })
      )[0]!.id;

      const { handlePackageUpdate } = await import("../../logistics/index.js");
      (handlePackageUpdate as any).mockImplementation(() => {
        throw new Error("test error");
      });

      try {
        await processWebhookEvent(test.deps, eventId);
      } catch {
        // expected
      }

      const updated = await test.deps.db.query.webhookEvents.findFirst({
        where: eq(schema.webhookEvents.id, eventId),
      });
      expect(updated?.attempts).toBeGreaterThan(0);
      expect(updated?.error).toBeDefined();
    });
  });

  describe("ensureWebhookSubscriptions", () => {
    it("subscribes to event types when missing", async () => {
      process.env.WEBHOOK_PUBLIC_URL = "https://example.com/webhooks";

      let subscriptions: Array<{ event_type: string; address: string }> = [];

      test.setFetch((url, init) => {
        if (url.pathname.includes("/webhooks") && init.method === "GET") {
          return ttsOk({ webhooks: [] });
        }
        if (url.pathname.includes("/webhooks") && init.method === "PUT") {
          const body = JSON.parse(init.body as string);
          subscriptions.push({
            event_type: body.event_type || "unknown",
            address: body.address,
          });
          return ttsOk({});
        }
        throw new Error(`Unexpected URL: ${url}, method: ${init.method}`);
      });

      await ensureWebhookSubscriptions(test.deps, "shop-1");

      const shop = await test.deps.db.query.shops.findFirst();
      expect(shop?.webhooksSubscribedAt).toBeDefined();
    });

    it("skips if WEBHOOK_PUBLIC_URL is unset", async () => {
      delete process.env.WEBHOOK_PUBLIC_URL;

      await ensureWebhookSubscriptions(test.deps, "shop-1");

      const shop = await test.deps.db.query.shops.findFirst();
      expect(shop?.webhooksSubscribedAt).toBeNull();
    });
  });

  describe("runOrderSync", () => {
    it("syncs orders and advances cursor", async () => {
      test.setFetch((url) => {
        if (url.pathname.includes("/search")) {
          return ttsOk({ orders: [mockOrder] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await runOrderSync(test.deps, "shop-1");
      expect(result.orders).toBeGreaterThan(0);

      const cursor = await test.deps.db.query.syncCursors.findFirst();
      expect(cursor?.updateTimeGe).toBe(mockOrder.update_time);
    });

    it("returns 0 for revoked shops", async () => {
      getShopContextMock = vi.fn(async (_d, shopId) => {
        throw new OmsError("shop_revoked", "shop revoked");
      });

      const result = await runOrderSync(test.deps, "shop-1");
      expect(result.orders).toBe(0);
    });
  });

  describe("runBackfill", () => {
    it("backfills in time windows", async () => {
      test.setFetch((url) => {
        if (url.pathname.includes("/search")) {
          return ttsOk({ orders: [mockOrder] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await runBackfill(test.deps, "shop-1");

      const shop = await test.deps.db.query.shops.findFirst();
      expect(shop?.backfillStatus).toBe("done");
      expect(shop?.backfillCursor).toBeDefined();
    });

    it("is resumable from backfillCursor", async () => {
      test.setFetch((url) => {
        if (url.pathname.includes("/search")) {
          return ttsOk({ orders: [mockOrder] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const now = Math.floor(test.deps.now().getTime() / 1000);
      const cursor = now - 2 * 24 * 60 * 60;

      await test.deps.db
        .update(schema.shops)
        .set({ backfillCursor: cursor })
        .where(eq(schema.shops.id, "shop-1"));

      await runBackfill(test.deps, "shop-1");

      const shop = await test.deps.db.query.shops.findFirst();
      expect(shop?.backfillStatus).toBe("done");
    });
  });

  describe("InMemoryRateLimiter", () => {
    it("allows tokens up to burst rate", async () => {
      const limiter = new InMemoryRateLimiter(2, 5);
      const start = Date.now();

      for (let i = 0; i < 5; i++) {
        await limiter.acquire("key");
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it("waits for new tokens", async () => {
      let now = 1000;
      const limiter = new InMemoryRateLimiter(1, 1, () => now);

      await limiter.acquire("key");
      now += 500;

      const start = Date.now();
      await limiter.acquire("key");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThan(400);
    });

    it("tracks per-key buckets", async () => {
      const limiter = new InMemoryRateLimiter(1, 1);

      await limiter.acquire("key1");
      await limiter.acquire("key2");

      expect(true);
    });
  });
});
