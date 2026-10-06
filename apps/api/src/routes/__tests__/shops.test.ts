import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDeps } from "@oms/core/testing";
import { buildApp } from "../../app.js";
import { eq } from "drizzle-orm";
import { authorizations, shops } from "@oms/db";

describe("shops routes", () => {
  let test: Awaited<ReturnType<typeof createTestDeps>>;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    test = await createTestDeps();
    app = await buildApp({
      deps: test.deps,
      logger: false,
      testUser: { id: "u1", email: "admin@test.com", name: "Admin", role: "admin" },
    });
  });

  afterEach(async () => {
    await app.close();
    await test.close();
  });

  describe("GET /v1/shops", () => {
    it("returns empty array if no shops", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/shops",
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it("returns list of shops", async () => {
      const now = test.deps.now();
      const authId = "auth1";

      // Insert authorization and shop
      // Use 30 days for refresh token expiry (more than 7 days, so should be "active" not "expiring")
      await test.deps.db.insert(authorizations).values({
        id: authId,
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt("token"),
        accessTokenExpiresAt: new Date(now.getTime() + 3600000),
        refreshTokenEnc: test.deps.cipher.encrypt("refresh"),
        refreshTokenExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });

      await test.deps.db.insert(shops).values({
        id: "shop1",
        name: "Shop 1",
        region: "US",
        cipher: "cipher1",
        authorizationId: authId,
        active: true,
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/shops",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.length).toBe(1);
      expect(body[0].id).toBe("shop1");
      expect(body[0].name).toBe("Shop 1");
      expect(body[0].authStatus).toBe("active");
    });

    it("requires viewer role or higher", async () => {
      const viewerApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: { id: "u1", email: "viewer@test.com", name: "Viewer", role: "viewer" },
      });

      const res = await viewerApp.inject({
        method: "GET",
        url: "/v1/shops",
      });

      expect(res.statusCode).toBe(200); // Viewer can access

      const unauthApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: undefined,
      });

      const res2 = await unauthApp.inject({
        method: "GET",
        url: "/v1/shops",
      });

      expect(res2.statusCode).toBe(401); // Unauthenticated cannot access

      await viewerApp.close();
      await unauthApp.close();
    });
  });

  describe("POST /v1/shops/:id/resync", () => {
    it("returns 404 if shop does not exist", async () => {
      const opsApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: { id: "u1", email: "ops@test.com", name: "Ops", role: "ops" },
      });

      const res = await opsApp.inject({
        method: "POST",
        url: "/v1/shops/nonexistent/resync",
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe("shop_not_found");

      await opsApp.close();
    });

    it("enqueues order sync job and returns 202", async () => {
      const opsApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: { id: "u1", email: "ops@test.com", name: "Ops", role: "ops" },
      });

      const now = test.deps.now();
      const authId = "auth1";

      // Insert authorization and shop
      await test.deps.db.insert(authorizations).values({
        id: authId,
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt("token"),
        accessTokenExpiresAt: new Date(now.getTime() + 3600000),
        refreshTokenEnc: test.deps.cipher.encrypt("refresh"),
        refreshTokenExpiresAt: new Date(now.getTime() + 86400000),
      });

      await test.deps.db.insert(shops).values({
        id: "shop1",
        name: "Shop 1",
        region: "US",
        cipher: "cipher1",
        authorizationId: authId,
        active: true,
      });

      const res = await opsApp.inject({
        method: "POST",
        url: "/v1/shops/shop1/resync",
      });

      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body)).toEqual({ ok: true });

      // Verify job was enqueued
      const orderSyncJobs = test.queues.jobs.filter((j) => j.queue === "tts-order-sync");
      expect(orderSyncJobs.length).toBe(1);
      expect(orderSyncJobs[0]!.data).toEqual({ shopId: "shop1" });

      await opsApp.close();
    });

    it("requires ops role or higher", async () => {
      const viewerApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: { id: "u1", email: "viewer@test.com", name: "Viewer", role: "viewer" },
      });

      const res = await viewerApp.inject({
        method: "POST",
        url: "/v1/shops/shop1/resync",
      });

      expect(res.statusCode).toBe(403); // Viewer cannot access

      await viewerApp.close();
    });

    it("requires authentication", async () => {
      const unauthApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: undefined,
      });

      const res = await unauthApp.inject({
        method: "POST",
        url: "/v1/shops/shop1/resync",
      });

      expect(res.statusCode).toBe(401); // Unauthenticated cannot access

      await unauthApp.close();
    });
  });
});
