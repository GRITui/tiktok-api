import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig({ TTS_APP_KEY: "key", TTS_APP_SECRET: "secret" });

describe("api", () => {
  it("healthz", async () => {
    const app = await buildApp(config);
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toEqual({ ok: true });
  });

  it("rejects unsigned webhooks and accepts signed ones", async () => {
    const app = await buildApp(config);
    const payload = JSON.stringify({ type: 1, tts_notification_id: "n1", shop_id: "s1", timestamp: 1, data: {} });
    const bad = await app.inject({ method: "POST", url: "/webhooks/tiktok", payload, headers: { "content-type": "application/json" } });
    expect(bad.statusCode).toBe(401);

    const sig = createHmac("sha256", "secret").update(`key${payload}`).digest("hex");
    const good = await app.inject({
      method: "POST", url: "/webhooks/tiktok", payload,
      headers: { "content-type": "application/json", authorization: sig },
    });
    expect(good.statusCode).toBe(200);
  });
});
