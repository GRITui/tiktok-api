import { describe, it, expect, beforeEach } from "vitest";
import { createTestDeps } from "@oms/core/testing";
import { buildApp } from "../../app.js";
import { schema } from "@oms/db";

describe("Jobs Routes", () => {
  let deps: any;

  beforeEach(async () => {
    const result = await createTestDeps({
      fileStorageDir: "/tmp/test-jobs-" + Date.now(),
    });
    deps = result.deps;
  });

  it("GET /v1/jobs/:id returns job view", async () => {
    const job = await deps.db.insert(schema.jobs).values({
      type: "order_export",
      status: "succeeded",
      total: 10,
      succeeded: 10,
      failed: 0,
      result: { filePath: "/tmp/export.csv", contentType: "text/csv" },
    }).returning();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/jobs/${job[0].id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.type).toBe("order_export");
    expect(body.status).toBe("succeeded");
    expect(body.downloadUrl).toBeDefined();
  });

  it("GET /v1/jobs/:id returns 404 for nonexistent job", async () => {
    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/jobs/nonexistent",
    });

    expect(response.statusCode).toBe(404);
  });

  it("GET /v1/jobs/:id requires authentication", async () => {
    const app = await buildApp({ deps, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/v1/jobs/some-id",
    });

    expect(response.statusCode).toBe(401);
  });

  it("GET /v1/jobs/:id/download requires ops role", async () => {
    const job = await deps.db.insert(schema.jobs).values({
      type: "order_export",
      status: "succeeded",
      total: 10,
      succeeded: 10,
      failed: 0,
      result: { filePath: "/tmp/export.csv", contentType: "text/csv" },
    }).returning();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "viewer" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/jobs/${job[0].id}/download`,
    });

    expect(response.statusCode).toBe(403);
  });

  it("GET /v1/jobs/:id/download returns 404 when no file available", async () => {
    const job = await deps.db.insert(schema.jobs).values({
      type: "order_export",
      status: "succeeded",
      total: 0,
      succeeded: 0,
      failed: 0,
    }).returning();

    const app = await buildApp({
      deps,
      logger: false,
      testUser: { id: "user-1", email: "test@example.com", name: null, role: "ops" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/jobs/${job[0].id}/download`,
    });

    expect(response.statusCode).toBe(404);
  });
});
