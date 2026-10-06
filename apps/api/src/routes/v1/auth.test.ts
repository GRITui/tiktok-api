import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@oms/core";
import { createTestDeps } from "@oms/core/testing";
import { buildApp } from "../../app.js";

describe("Auth Routes", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps();
    deps = result.deps;
  });

  it("POST /v1/auth/login returns session cookie and user", async () => {
    // Create a user first
    await createUser(deps, {
      email: "test@example.com",
      password: "secret123",
      role: "viewer",
    });

    const app = await buildApp({ deps, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "test@example.com", password: "secret123" },
    });

    expect(response.statusCode).toBe(200);
    const user = JSON.parse(response.body);
    expect(user.email).toBe("test@example.com");
    expect(user.role).toBe("viewer");

    // Check cookie was set
    const cookie = response.cookies.find((c) => c.name === "oms_session");
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
  });

  it("POST /v1/auth/login rejects invalid credentials", async () => {
    const app = await buildApp({ deps, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "test@example.com", password: "wrong" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("GET /v1/me returns authenticated user", async () => {
    await createUser(deps, {
      email: "test@example.com",
      password: "secret",
      role: "admin",
    });

    const app = await buildApp({
      deps,
      logger: false,
      testUser: {
        id: "user-1",
        email: "test@example.com",
        name: null,
        role: "admin",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
    });

    expect(response.statusCode).toBe(200);
    const user = JSON.parse(response.body);
    expect(user.email).toBe("test@example.com");
  });

  it("GET /v1/me returns 401 when not authenticated", async () => {
    const app = await buildApp({ deps, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
    });

    expect(response.statusCode).toBe(401);
  });

  it("POST /v1/auth/logout clears cookie", async () => {
    const testUser = {
      id: "user-1",
      email: "test@example.com",
      name: null,
      role: "viewer" as const,
    };

    const app = await buildApp({
      deps,
      logger: false,
      testUser,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
  });
});
