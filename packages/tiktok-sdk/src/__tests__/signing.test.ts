import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signRequest, verifyWebhookSignature } from "../signing.js";

const secret = "test_secret";
const hmac = (s: string) => createHmac("sha256", secret).update(s).digest("hex");

describe("signRequest", () => {
  it("sorts params, excludes sign/access_token, wraps with secret", () => {
    const sig = signRequest({
      appSecret: secret,
      path: "/order/202309/orders",
      query: { timestamp: 1700000000, app_key: "abc", sign: "x", access_token: "t", ids: "1,2" },
    });
    expect(sig).toBe(hmac(`${secret}/order/202309/ordersapp_keyabcids1,2timestamp1700000000${secret}`));
  });

  it("appends JSON body", () => {
    const body = JSON.stringify({ order_status: "AWAITING_SHIPMENT" });
    const sig = signRequest({ appSecret: secret, path: "/p", query: { a: 1 }, body, contentType: "application/json" });
    expect(sig).toBe(hmac(`${secret}/pa1${body}${secret}`));
  });

  it("skips body for multipart and undefined params", () => {
    const sig = signRequest({ appSecret: secret, path: "/p", query: { a: 1, b: undefined }, body: "xx", contentType: "multipart/form-data; boundary=1" });
    expect(sig).toBe(hmac(`${secret}/pa1${secret}`));
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts matching and rejects tampered signatures", () => {
    const rawBody = '{"type":1}';
    const good = createHmac("sha256", secret).update(`key${rawBody}`).digest("hex");
    expect(verifyWebhookSignature({ appKey: "key", appSecret: secret, rawBody, signature: good })).toBe(true);
    expect(verifyWebhookSignature({ appKey: "key", appSecret: secret, rawBody: rawBody + " ", signature: good })).toBe(false);
    expect(verifyWebhookSignature({ appKey: "key", appSecret: secret, rawBody, signature: undefined })).toBe(false);
  });
});
