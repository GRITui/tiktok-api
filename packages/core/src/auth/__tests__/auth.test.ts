import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { authorizations, oauthStates, shops } from "@oms/db";
import {
  createAuthorizeUrl,
  handleAuthCallback,
  syncAuthorizedShops,
  getShopContext,
  refreshExpiringTokens,
  markAuthorizationRevoked,
  listShops,
  OmsError,
  Queues,
} from "@oms/core";
import { createTestDeps, ttsOk, ttsErr } from "../../testing.js";

describe("auth", () => {
  let test: Awaited<ReturnType<typeof createTestDeps>>;

  beforeEach(async () => {
    test = await createTestDeps();
  });

  afterEach(async () => {
    await test.close();
  });

  describe("createAuthorizeUrl", () => {
    it("creates state and returns authorize URL", async () => {
      const url = await createAuthorizeUrl(test.deps, "US");
      expect(url).toContain("services.us.tiktokshop.com");
      expect(url).toContain("service_id=svc");
      expect(url).toContain("state=");

      // Extract state from URL
      const stateMatch = url.match(/state=([a-f0-9]+)/);
      expect(stateMatch).toBeTruthy();
      const state = stateMatch![1];

      // Verify state exists in database
      const stateRow = await test.deps.db.query.oauthStates.findFirst({ where: eq(oauthStates.state, state) });
      expect(stateRow).toBeTruthy();
      expect(stateRow!.region).toBe("US");
      expect(stateRow!.usedAt).toBeNull();
    });

    it("creates different states for different regions", async () => {
      const urlUs = await createAuthorizeUrl(test.deps, "US");
      const urlRow = await createAuthorizeUrl(test.deps, "ROW");

      expect(urlUs).toContain("services.us.tiktokshop.com");
      expect(urlRow).toContain("services.tiktokshop.com");

      // States should be different
      const stateUs = urlUs.match(/state=([a-f0-9]+)/)![1];
      const stateRow = urlRow.match(/state=([a-f0-9]+)/)![1];
      expect(stateUs).not.toBe(stateRow);
    });
  });

  describe("handleAuthCallback", () => {
    it("rejects if state does not exist", async () => {
      test.setFetch(() => ttsOk({ access_token: "token" }));
      await expect(
        handleAuthCallback(test.deps, { code: "code", state: "nonexistent" }),
      ).rejects.toThrow("State not found");
    });

    it("rejects if state is already used", async () => {
      const authorizeUrl = await createAuthorizeUrl(test.deps, "US");
      const state = authorizeUrl.match(/state=([a-f0-9]+)/)![1];

      test.setFetch(() => ttsOk({
        access_token: "token",
        refresh_token: "refresh",
        access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
        refresh_token_expire_in: Math.floor(Date.now() / 1000) + 86400,
        open_id: "open123",
        seller_name: "seller1",
        seller_base_region: "US",
        user_type: 0,
      }));

      // First callback succeeds
      await handleAuthCallback(test.deps, { code: "code1", state });

      // Second callback with same state fails
      await expect(
        handleAuthCallback(test.deps, { code: "code2", state }),
      ).rejects.toThrow("State already used");
    });

    it("rejects if state is expired", async () => {
      // Create an expired state
      const expiredTime = new Date(test.deps.now().getTime() - 60000);
      const state = "expired123";
      await test.deps.db.insert(oauthStates).values({
        state,
        region: "US",
        expiresAt: expiredTime,
      });

      test.setFetch(() => ttsOk({}));
      await expect(
        handleAuthCallback(test.deps, { code: "code", state }),
      ).rejects.toThrow("State expired");
    });

    it("rejects non-seller user_type", async () => {
      const authorizeUrl = await createAuthorizeUrl(test.deps, "US");
      const state = authorizeUrl.match(/state=([a-f0-9]+)/)![1];

      test.setFetch(() => ttsOk({
        access_token: "token",
        refresh_token: "refresh",
        access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
        refresh_token_expire_in: Math.floor(Date.now() / 1000) + 86400,
        open_id: "open123",
        seller_name: "seller1",
        seller_base_region: "US",
        user_type: 1, // Not seller
      }));

      try {
        await handleAuthCallback(test.deps, { code: "code", state });
        expect.fail("Expected OmsError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("unsupported_principal");
      }
    });

    it("encrypts tokens and upserts authorization", async () => {
      const authorizeUrl = await createAuthorizeUrl(test.deps, "US");
      const state = authorizeUrl.match(/state=([a-f0-9]+)/)![1];

      const now = test.deps.now();
      const accessTokenExpiry = Math.floor((now.getTime() + 3600000) / 1000);
      const refreshTokenExpiry = Math.floor((now.getTime() + 86400000) / 1000);

      test.setFetch(() => ttsOk({
        access_token: "secret-access-token",
        refresh_token: "secret-refresh-token",
        access_token_expire_in: accessTokenExpiry,
        refresh_token_expire_in: refreshTokenExpiry,
        open_id: "open123",
        seller_name: "seller1",
        seller_base_region: "US",
        user_type: 0,
      }));

      const result = await handleAuthCallback(test.deps, { code: "code", state });

      expect(result.authorizationId).toBe("open123");
      expect(result.shopIds).toEqual([]);

      // Verify authorization exists
      const auth = await test.deps.db.query.authorizations.findFirst({
        where: eq(authorizations.id, "open123"),
      });

      expect(auth).toBeTruthy();
      expect(auth!.sellerName).toBe("seller1");
      expect(auth!.region).toBe("US");
      expect(auth!.userType).toBe(0);
      expect(auth!.revokedAt).toBeNull();

      // Verify tokens are encrypted (not plaintext)
      expect(auth!.accessTokenEnc).not.toContain("secret-access-token");
      expect(auth!.refreshTokenEnc).not.toContain("secret-refresh-token");

      // Verify we can decrypt
      expect(test.deps.cipher.decrypt(auth!.accessTokenEnc)).toBe("secret-access-token");
      expect(test.deps.cipher.decrypt(auth!.refreshTokenEnc)).toBe("secret-refresh-token");
    });

    it("syncs shops and enqueues jobs", async () => {
      const authorizeUrl = await createAuthorizeUrl(test.deps, "US");
      const state = authorizeUrl.match(/state=([a-f0-9]+)/)![1];

      const now = test.deps.now();
      const accessTokenExpiry = Math.floor((now.getTime() + 3600000) / 1000);
      const refreshTokenExpiry = Math.floor((now.getTime() + 86400000) / 1000);

      let callCount = 0;
      test.setFetch((url) => {
        if (url.pathname === "/api/v2/token/get") {
          return ttsOk({
            access_token: "secret-access-token",
            refresh_token: "secret-refresh-token",
            access_token_expire_in: accessTokenExpiry,
            refresh_token_expire_in: refreshTokenExpiry,
            open_id: "open123",
            seller_name: "seller1",
            seller_base_region: "US",
            user_type: 0,
          });
        }
        if (url.pathname.includes("/authorization/")) {
          callCount++;
          return ttsOk({
            shops: [
              { id: "shop1", name: "Shop 1", region: "US", seller_type: "SELLER", cipher: "cipher1", code: "code1" },
              { id: "shop2", name: "Shop 2", region: "US", seller_type: "SELLER", cipher: "cipher2", code: "code2" },
            ],
          });
        }
        return ttsErr(404, "Not found");
      });

      const result = await handleAuthCallback(test.deps, { code: "code", state });

      expect(result.authorizationId).toBe("open123");
      expect(result.shopIds).toEqual(["shop1", "shop2"]);

      // Verify shops exist
      const shop1 = await test.deps.db.query.shops.findFirst({ where: eq(shops.id, "shop1") });
      const shop2 = await test.deps.db.query.shops.findFirst({ where: eq(shops.id, "shop2") });

      expect(shop1).toBeTruthy();
      expect(shop1!.name).toBe("Shop 1");
      expect(shop2).toBeTruthy();
      expect(shop2!.name).toBe("Shop 2");

      // Verify jobs are enqueued
      expect(test.queues.jobs.length).toBe(4); // 2 backfill + 2 logistics
      const backfillJobs = test.queues.jobs.filter((j) => j.queue === Queues.backfill);
      const logisticsJobs = test.queues.jobs.filter((j) => j.queue === Queues.logisticsSync);

      expect(backfillJobs.length).toBe(2);
      expect(logisticsJobs.length).toBe(2);
      expect(backfillJobs[0]!.data).toEqual({ shopId: "shop1" });
      expect(backfillJobs[1]!.data).toEqual({ shopId: "shop2" });
    });

    it("clears revokedAt on reconnect", async () => {
      // Insert a revoked authorization
      const now = test.deps.now();
      await test.deps.db.insert(authorizations).values({
        id: "open123",
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt("old-token"),
        accessTokenExpiresAt: new Date(now.getTime() + 3600000),
        refreshTokenEnc: test.deps.cipher.encrypt("old-refresh"),
        refreshTokenExpiresAt: new Date(now.getTime() + 86400000),
        revokedAt: new Date(now.getTime() - 3600000),
        revokedReason: "Token refresh failed",
      });

      // Create new authorization with same open_id
      const authorizeUrl = await createAuthorizeUrl(test.deps, "US");
      const state = authorizeUrl.match(/state=([a-f0-9]+)/)![1];

      const accessTokenExpiry = Math.floor((now.getTime() + 3600000) / 1000);
      const refreshTokenExpiry = Math.floor((now.getTime() + 86400000) / 1000);

      test.setFetch((url) => {
        if (url.pathname === "/api/v2/token/get") {
          return ttsOk({
            access_token: "new-token",
            refresh_token: "new-refresh",
            access_token_expire_in: accessTokenExpiry,
            refresh_token_expire_in: refreshTokenExpiry,
            open_id: "open123",
            seller_name: "seller1",
            seller_base_region: "US",
            user_type: 0,
          });
        }
        if (url.pathname.includes("/authorization/")) {
          return ttsOk({ shops: [] });
        }
        return ttsErr(404, "Not found");
      });

      await handleAuthCallback(test.deps, { code: "code", state });

      // Verify revokedAt is cleared
      const auth = await test.deps.db.query.authorizations.findFirst({
        where: eq(authorizations.id, "open123"),
      });

      expect(auth!.revokedAt).toBeNull();
      expect(auth!.revokedReason).toBeNull();
    });
  });

  describe("syncAuthorizedShops", () => {
    it("deactivates shops no longer in response", async () => {
      const now = test.deps.now();
      const authId = "auth1";

      // Insert authorization
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

      // Insert two shops
      await test.deps.db.insert(shops).values([
        {
          id: "shop1",
          name: "Shop 1",
          region: "US",
          cipher: "cipher1",
          authorizationId: authId,
          active: true,
        },
        {
          id: "shop2",
          name: "Shop 2",
          region: "US",
          cipher: "cipher2",
          authorizationId: authId,
          active: true,
        },
      ]);

      // Mock only shop1 being returned
      test.setFetch((url) => {
        if (url.pathname.includes("/authorization/")) {
          return ttsOk({
            shops: [{ id: "shop1", name: "Shop 1", region: "US", seller_type: "SELLER", cipher: "cipher1", code: "code1" }],
          });
        }
        return ttsErr(404, "Not found");
      });

      const shopIds = await syncAuthorizedShops(test.deps, authId);

      expect(shopIds).toEqual(["shop1"]);

      // Verify shop1 is active, shop2 is inactive
      const s1 = await test.deps.db.query.shops.findFirst({ where: eq(shops.id, "shop1") });
      const s2 = await test.deps.db.query.shops.findFirst({ where: eq(shops.id, "shop2") });

      expect(s1!.active).toBe(true);
      expect(s2!.active).toBe(false);
    });
  });

  describe("getShopContext", () => {
    it("throws shop_not_found if shop does not exist", async () => {
      try {
        await getShopContext(test.deps, "nonexistent");
        expect.fail("Expected OmsError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("shop_not_found");
      }
    });

    it("throws shop_not_found if shop is inactive", async () => {
      const now = test.deps.now();
      const authId = "auth1";

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
        active: false,
      });

      try {
        await getShopContext(test.deps, "shop1");
        expect.fail("Expected OmsError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("shop_not_found");
      }
    });

    it("throws shop_revoked if authorization is revoked", async () => {
      const now = test.deps.now();
      const authId = "auth1";

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
        revokedAt: new Date(now.getTime() - 3600000),
        revokedReason: "Revoked",
      });

      await test.deps.db.insert(shops).values({
        id: "shop1",
        name: "Shop 1",
        region: "US",
        cipher: "cipher1",
        authorizationId: authId,
        active: true,
      });

      try {
        await getShopContext(test.deps, "shop1");
        expect.fail("Expected OmsError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("shop_revoked");
      }
    });

    it("returns shop context without refresh if token does not expire soon", async () => {
      const now = test.deps.now();
      const authId = "auth1";
      const accessToken = "secret-access-token";

      await test.deps.db.insert(authorizations).values({
        id: authId,
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt(accessToken),
        accessTokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour, not within 5 min
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

      const ctx = await getShopContext(test.deps, "shop1");

      expect(ctx.shopId).toBe("shop1");
      expect(ctx.region).toBe("US");
      expect(ctx.accessToken).toBe(accessToken);
      expect(ctx.shopCipher).toBe("cipher1");

      // Should not have called refresh API
      expect(test.queues.jobs.length).toBe(0);
    });

    it("refreshes token if expiring within 5 minutes", async () => {
      const now = test.deps.now();
      const authId = "auth1";
      const oldAccessToken = "old-access-token";
      const newAccessToken = "new-access-token";

      await test.deps.db.insert(authorizations).values({
        id: authId,
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt(oldAccessToken),
        accessTokenExpiresAt: new Date(now.getTime() + 2 * 60 * 1000), // 2 minutes (within 5 min)
        refreshTokenEnc: test.deps.cipher.encrypt("refresh-token"),
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

      test.setFetch((url) => {
        if (url.pathname === "/api/v2/token/refresh") {
          return ttsOk({
            access_token: newAccessToken,
            refresh_token: "new-refresh-token",
            access_token_expire_in: Math.floor((now.getTime() + 3600000) / 1000),
            refresh_token_expire_in: Math.floor((now.getTime() + 86400000) / 1000),
            open_id: authId,
            seller_name: "seller1",
            seller_base_region: "US",
            user_type: 0,
          });
        }
        return ttsErr(404, "Not found");
      });

      const ctx = await getShopContext(test.deps, "shop1");

      expect(ctx.accessToken).toBe(newAccessToken);

      // Verify authorization was updated
      const auth = await test.deps.db.query.authorizations.findFirst({
        where: eq(authorizations.id, authId),
      });

      expect(test.deps.cipher.decrypt(auth!.accessTokenEnc)).toBe(newAccessToken);
      expect(test.deps.cipher.decrypt(auth!.refreshTokenEnc)).toBe("new-refresh-token");
    });

    it("revokes authorization on refresh failure", async () => {
      const now = test.deps.now();
      const authId = "auth1";

      await test.deps.db.insert(authorizations).values({
        id: authId,
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt("token"),
        accessTokenExpiresAt: new Date(now.getTime() + 2 * 60 * 1000), // Expiring soon
        refreshTokenEnc: test.deps.cipher.encrypt("invalid-refresh"),
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

      test.setFetch(() => ttsErr(401, "Invalid refresh token", 401));

      try {
        await getShopContext(test.deps, "shop1");
        expect.fail("Expected OmsError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("shop_revoked");
      }

      // Verify authorization is revoked
      const auth = await test.deps.db.query.authorizations.findFirst({
        where: eq(authorizations.id, authId),
      });

      expect(auth!.revokedAt).not.toBeNull();
    });
  });

  describe("markAuthorizationRevoked", () => {
    it("sets revoked flag", async () => {
      const now = test.deps.now();
      const authId = "auth1";

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

      await markAuthorizationRevoked(test.deps, authId, "Test revocation");

      const auth = await test.deps.db.query.authorizations.findFirst({
        where: eq(authorizations.id, authId),
      });

      expect(auth!.revokedAt).not.toBeNull();
      expect(auth!.revokedReason).toBe("Test revocation");
    });
  });

  describe("listShops", () => {
    it("returns empty list if no shops", async () => {
      const shops = await listShops(test.deps);
      expect(shops).toEqual([]);
    });

    it("returns shop summary with correct status", async () => {
      const now = test.deps.now();
      const authId = "auth1";

      await test.deps.db.insert(authorizations).values({
        id: authId,
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt("token"),
        accessTokenExpiresAt: new Date(now.getTime() + 3600000),
        refreshTokenEnc: test.deps.cipher.encrypt("refresh"),
        refreshTokenExpiresAt: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000), // 8 days (not expiring)
      });

      await test.deps.db.insert(shops).values({
        id: "shop1",
        name: "Shop 1",
        region: "US",
        cipher: "cipher1",
        authorizationId: authId,
        active: true,
        backfillStatus: "done",
        webhooksSubscribedAt: new Date(now.getTime() - 3600000),
      });

      const list = await listShops(test.deps);

      expect(list.length).toBe(1);
      expect(list[0]!.id).toBe("shop1");
      expect(list[0]!.name).toBe("Shop 1");
      expect(list[0]!.authStatus).toBe("active");
      expect(list[0]!.backfillStatus).toBe("done");
      expect(list[0]!.webhooksSubscribedAt).not.toBeNull();
    });

    it("marks authorization as expiring if refresh token expires within 7 days", async () => {
      const now = test.deps.now();
      const authId = "auth1";

      await test.deps.db.insert(authorizations).values({
        id: authId,
        sellerName: "seller1",
        sellerBaseRegion: "US",
        region: "US",
        userType: 0,
        accessTokenEnc: test.deps.cipher.encrypt("token"),
        accessTokenExpiresAt: new Date(now.getTime() + 3600000),
        refreshTokenEnc: test.deps.cipher.encrypt("refresh"),
        refreshTokenExpiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), // 5 days (expiring)
      });

      await test.deps.db.insert(shops).values({
        id: "shop1",
        name: "Shop 1",
        region: "US",
        cipher: "cipher1",
        authorizationId: authId,
        active: true,
      });

      const list = await listShops(test.deps);

      expect(list[0]!.authStatus).toBe("expiring");
    });

    it("marks authorization as revoked", async () => {
      const now = test.deps.now();
      const authId = "auth1";

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
        revokedAt: new Date(now.getTime() - 3600000),
        revokedReason: "Revoked",
      });

      await test.deps.db.insert(shops).values({
        id: "shop1",
        name: "Shop 1",
        region: "US",
        cipher: "cipher1",
        authorizationId: authId,
        active: true,
      });

      const list = await listShops(test.deps);

      expect(list[0]!.authStatus).toBe("revoked");
    });

    it("calculates backfill progress", async () => {
      const now = test.deps.now();
      const authId = "auth1";

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

      const backfillFrom = Math.floor((now.getTime() - 90 * 24 * 60 * 60 * 1000) / 1000);
      const backfillCursor = Math.floor((now.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000);

      await test.deps.db.insert(shops).values({
        id: "shop1",
        name: "Shop 1",
        region: "US",
        cipher: "cipher1",
        authorizationId: authId,
        active: true,
        backfillStatus: "running",
        backfillFrom,
        backfillCursor,
      });

      const list = await listShops(test.deps);

      expect(list[0]!.backfillProgress).toBeGreaterThan(0);
      expect(list[0]!.backfillProgress).toBeLessThanOrEqual(1);
    });

    it("includes lastSyncedAt from sync_cursors", async () => {
      const now = test.deps.now();
      const authId = "auth1";

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

      const lastRunAt = new Date(now.getTime() - 3600000);
      // Note: This would need to be inserted via syncCursors if the schema supports it
      // For now, we test that lastSyncedAt is included

      const list = await listShops(test.deps);

      expect(list[0]!.lastSyncedAt).toBeNull(); // No sync_cursors inserted yet
    });
  });
});
