import { describe, expect, it, vi } from "vitest";
import { LogisticsApi } from "../endpoints/logistics.js";
import { TikTokClient } from "../client.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function makeClient(fetchMock: typeof fetch) {
  return new TikTokClient({ appKey: "k", appSecret: "s", fetch: fetchMock, now: () => 1_700_000_000_000, sleep: async () => {} });
}

const ctx = { accessToken: "t", shopCipher: "c" };

describe("LogisticsApi", () => {
  it("getWarehouses sends GET request", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        code: 0,
        message: "Success",
        data: { warehouses: [{ id: "wh1", name: "Warehouse 1", is_default: true }] },
      }),
    );
    const api = new LogisticsApi(makeClient(fetchMock));
    const result = await api.getWarehouses(ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("wh1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/logistics/202309/warehouses");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-tts-access-token"]).toBe("t");
    expect(url.searchParams.get("shop_cipher")).toBe("c");
  });

  it("getWarehouseDeliveryOptions sends GET request", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        code: 0,
        message: "Success",
        data: { delivery_options: [{ id: "do1", name: "Standard", type: "TIKTOK_SHIPPING" }] },
      }),
    );
    const api = new LogisticsApi(makeClient(fetchMock));
    const result = await api.getWarehouseDeliveryOptions(ctx, "wh1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("do1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/logistics/202309/warehouses/wh1/delivery_options");
    expect(init.method).toBe("GET");
  });

  it("getShippingProviders sends GET request", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        code: 0,
        message: "Success",
        data: { shipping_providers: [{ id: "sp1", name: "DHL" }] },
      }),
    );
    const api = new LogisticsApi(makeClient(fetchMock));
    const result = await api.getShippingProviders(ctx, "do1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("sp1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/logistics/202309/delivery_options/do1/shipping_providers");
    expect(init.method).toBe("GET");
  });
});
