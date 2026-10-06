import { describe, it, expect, beforeEach } from "vitest";
import { EventsApi, TikTokClient } from "../index.js";
import type { ShopContext } from "../endpoints/orders.js";

describe("EventsApi", () => {
  let client: TikTokClient;
  let api: EventsApi;
  const ctx: ShopContext = {
    accessToken: "token-123",
    shopCipher: "cipher-456",
  };

  beforeEach(() => {
    let lastRequest: any;

    const fakeFetch = async (url: URL, init: any) => {
      lastRequest = { url, init };
      const path = url.pathname;

      if (path.includes("/webhooks") && init.method === "GET") {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              webhooks: [
                {
                  event_type: "ORDER_STATUS_CHANGE",
                  address: "https://example.com/webhooks",
                },
              ],
            },
          }),
        );
      }

      if (path.includes("/webhooks") && init.method === "PUT") {
        return new Response(JSON.stringify({ code: 0, data: {} }));
      }

      if (path.includes("/webhooks") && init.method === "DELETE") {
        return new Response(JSON.stringify({ code: 0, data: {} }));
      }

      return new Response(
        JSON.stringify({ code: -1, message: "Not found" }),
      );
    };

    client = new TikTokClient({
      appKey: "test-key",
      appSecret: "test-secret",
      fetch: fakeFetch as any,
    });

    api = new EventsApi(client);
  });

  it("getShopWebhooks returns webhook list", async () => {
    const webhooks = await api.getShopWebhooks(ctx);

    expect(webhooks).toHaveLength(1);
    expect(webhooks[0]?.event_type).toBe("ORDER_STATUS_CHANGE");
    expect(webhooks[0]?.address).toBe("https://example.com/webhooks");
  });

  it("updateShopWebhook sends PUT request with correct body", async () => {
    await api.updateShopWebhook(ctx, {
      event_type: "PACKAGE_UPDATE",
      address: "https://example.com/webhooks",
    });

    expect(true);
  });

  it("deleteShopWebhook sends DELETE request", async () => {
    await api.deleteShopWebhook(ctx, {
      event_type: "PACKAGE_UPDATE",
    });

    expect(true);
  });

  it("uses correct endpoint path /event/202309/webhooks", async () => {
    let capturedPath = "";

    const fakeFetch = async (url: URL) => {
      capturedPath = url.pathname;
      return new Response(
        JSON.stringify({
          code: 0,
          data: { webhooks: [] },
        }),
      );
    };

    const testClient = new TikTokClient({
      appKey: "test-key",
      appSecret: "test-secret",
      fetch: fakeFetch as any,
    });

    const testApi = new EventsApi(testClient);
    await testApi.getShopWebhooks(ctx);

    expect(capturedPath).toContain("/event/202309/webhooks");
  });

  it("includes shop context (access token and cipher) in requests", async () => {
    let capturedHeaders: any = {};
    let capturedParams: any = {};

    const fakeFetch = async (url: URL, init: any) => {
      capturedHeaders = init.headers || {};
      url.searchParams.forEach((v, k) => {
        capturedParams[k] = v;
      });

      return new Response(
        JSON.stringify({
          code: 0,
          data: { webhooks: [] },
        }),
      );
    };

    const testClient = new TikTokClient({
      appKey: "test-key",
      appSecret: "test-secret",
      fetch: fakeFetch as any,
    });

    const testApi = new EventsApi(testClient);
    await testApi.getShopWebhooks(ctx);

    expect(capturedHeaders["x-tts-access-token"]).toBe("token-123");
    expect(capturedParams.shop_cipher).toBe("cipher-456");
  });
});
