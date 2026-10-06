import { createTestDeps } from "@oms/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

let t: Awaited<ReturnType<typeof createTestDeps>>;
beforeAll(async () => { t = await createTestDeps(); });
afterAll(async () => { await t.close(); });

const user = (role: "viewer" | "ops") => ({ id: "u1", email: `${role}@x.y`, name: null, role });

describe("seller shipping routes", () => {
  it("requires an Idempotency-Key to ship", async () => {
    const app = await buildApp({ deps: t.deps, logger: false, testUser: user("ops") });
    const res = await app.inject({
      method: "POST", url: "/v1/packages/P1/ship-seller",
      payload: { shippingProviderId: "K", trackingNumber: "KEX12345" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("idempotency_key_required");
  });

  it("validates the body", async () => {
    const app = await buildApp({ deps: t.deps, logger: false, testUser: user("ops") });
    const res = await app.inject({
      method: "PUT", url: "/v1/packages/P1/tracking", headers: { "idempotency-key": "key-12345" }, payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("is ops-only", async () => {
    const app = await buildApp({ deps: t.deps, logger: false, testUser: user("viewer") });
    const res = await app.inject({ method: "GET", url: "/v1/packages/P1/shipping-providers" });
    expect(res.statusCode).toBe(403);
  });

  it("serves the CSV template and previews files", async () => {
    const app = await buildApp({ deps: t.deps, logger: false, testUser: user("ops") });
    const tpl = await app.inject({ method: "GET", url: "/v1/fulfillment/tracking-import/template" });
    expect(tpl.headers["content-type"]).toContain("text/csv");
    expect(tpl.body).toContain("tracking_number");
    const preview = await app.inject({
      method: "POST", url: "/v1/fulfillment/tracking-import/preview", payload: { csv: "NOPE,KERRY,KEX12345" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ ok: 0, errors: 1 });
  });
});
