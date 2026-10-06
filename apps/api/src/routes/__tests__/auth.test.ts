import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDeps, ttsOk } from "@oms/core/testing";
import { buildApp } from "../../app.js";

describe("auth routes", () => {
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

  describe("GET /auth/tiktok/connect", () => {
    it("returns 400 if region is missing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/tiktok/connect",
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe("invalid_region");
    });

    it("returns 400 if region is invalid", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/tiktok/connect?region=INVALID",
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe("invalid_region");
    });

    it("returns 302 redirect to authorize URL for US", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/tiktok/connect?region=US",
      });

      expect(res.statusCode).toBe(302);
      const location = res.headers.location as string;
      expect(location).toContain("services.us.tiktokshop.com");
      expect(location).toContain("state=");
    });

    it("returns 302 redirect to authorize URL for ROW", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/tiktok/connect?region=ROW",
      });

      expect(res.statusCode).toBe(302);
      const location = res.headers.location as string;
      expect(location).toContain("services.tiktokshop.com");
      expect(location).not.toContain("services.us.tiktokshop.com");
      expect(location).toContain("state=");
    });

    it("requires admin role", async () => {
      const viewerApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: { id: "u2", email: "viewer@test.com", name: "Viewer", role: "viewer" },
      });

      const res = await viewerApp.inject({
        method: "GET",
        url: "/auth/tiktok/connect?region=US",
      });

      expect(res.statusCode).toBe(403);
      await viewerApp.close();
    });
  });

  describe("GET /auth/tiktok/callback", () => {
    it("returns 302 to /shops?error=missing_params if code is missing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/tiktok/callback?state=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/shops?error=missing_params");
    });

    it("returns 302 to /shops?error=missing_params if state is missing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/tiktok/callback?code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/shops?error=missing_params");
    });

    it("returns 302 to /shops?error=invalid_state if state does not exist", async () => {
      test.setFetch(() => ttsOk({}));

      const res = await app.inject({
        method: "GET",
        url: "/auth/tiktok/callback?code=abc&state=nonexistent",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/shops?error=invalid_state");
    });

    it("returns 302 to /shops?connected=1 on success", async () => {
      // Create a state first
      const authorizeUrl = await test.deps.db.query.oauthStates.findFirst({});

      if (!authorizeUrl) {
        // Create state manually
        const state = "test-state";
        const expiresAt = new Date(test.deps.now().getTime() + 10 * 60 * 1000);
        await test.deps.db.insert(
          (await import("@oms/db")).oauthStates,
        ).values({
          state,
          region: "US",
          expiresAt,
        });

        const now = test.deps.now();
        const accessTokenExpiry = Math.floor((now.getTime() + 3600000) / 1000);
        const refreshTokenExpiry = Math.floor((now.getTime() + 86400000) / 1000);

        test.setFetch((url) => {
          if (url.pathname === "/api/v2/token/get") {
            return ttsOk({
              access_token: "token",
              refresh_token: "refresh",
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
          return new Response("", { status: 404 });
        });

        const res = await app.inject({
          method: "GET",
          url: `/auth/tiktok/callback?code=code&state=${state}`,
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/shops?connected=1");
      }
    });

    it("returns 302 to /shops?error=<code> on error", async () => {
      const state = "test-state";
      const expiresAt = new Date(test.deps.now().getTime() + 10 * 60 * 1000);
      await test.deps.db.insert(
        (await import("@oms/db")).oauthStates,
      ).values({
        state,
        region: "US",
        expiresAt,
      });

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

      const res = await app.inject({
        method: "GET",
        url: `/auth/tiktok/callback?code=code&state=${state}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/shops?error=unsupported_principal");
    });

    it("does not require authentication", async () => {
      const unauthApp = await buildApp({
        deps: test.deps,
        logger: false,
        testUser: undefined, // No test user
      });

      const state = "test-state";
      const expiresAt = new Date(test.deps.now().getTime() + 10 * 60 * 1000);
      await test.deps.db.insert(
        (await import("@oms/db")).oauthStates,
      ).values({
        state,
        region: "US",
        expiresAt,
      });

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

      // Mock API call to get shops
      test.setFetch((url) => {
        if (url.pathname === "/api/v2/token/get") {
          return ttsOk({
            access_token: "token",
            refresh_token: "refresh",
            access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
            refresh_token_expire_in: Math.floor(Date.now() / 1000) + 86400,
            open_id: "open123",
            seller_name: "seller1",
            seller_base_region: "US",
            user_type: 0,
          });
        }
        if (url.pathname.includes("/authorization/")) {
          return ttsOk({ shops: [] });
        }
        return new Response("", { status: 404 });
      });

      const res = await unauthApp.inject({
        method: "GET",
        url: `/auth/tiktok/callback?code=code&state=${state}`,
      });

      // Should succeed even without authentication
      expect(res.statusCode).toBe(302);
      await unauthApp.close();
    });
  });
});
