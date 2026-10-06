import { createHmac } from "node:crypto";
import { createTestDeps } from "@oms/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

let t: Awaited<ReturnType<typeof createTestDeps>>;
beforeAll(async () => { t = await createTestDeps(); });
afterAll(async () => { await t.close(); });

describe("api", () => {
  it("healthz", async () => {
    const app = await buildApp({ deps: t.deps, logger: false });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toEqual({ ok: true });
  });

  it("rejects unsigned webhooks", async () => {
    const app = await buildApp({ deps: t.deps, logger: false });
    const payload = JSON.stringify({ type: 1, tts_notification_id: "n1", shop_id: "s1", timestamp: 1, data: {} });
    const bad = await app.inject({ method: "POST", url: "/webhooks/tiktok", payload, headers: { "content-type": "application/json" } });
    expect(bad.statusCode).toBe(401);
    const sig = createHmac("sha256", t.deps.config.appSecret).update(`${t.deps.config.appKey}${payload}`).digest("hex");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});
