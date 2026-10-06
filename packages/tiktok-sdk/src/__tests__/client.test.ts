import { describe, expect, it, vi } from "vitest";
import { TikTokApiError, TikTokClient, OrdersApi } from "../index.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function makeClient(fetchMock: typeof fetch) {
  return new TikTokClient({ appKey: "k", appSecret: "s", fetch: fetchMock, now: () => 1_700_000_000_000, sleep: async () => {} });
}

describe("TikTokClient", () => {
  it("adds common params, token header and unwraps data", async () => {
    const fetchMock = vi.fn(async () => json(200, { code: 0, message: "Success", data: { ok: true } }));
    const data = await makeClient(fetchMock as unknown as typeof fetch).request({
      method: "GET", path: "/x", accessToken: "tok", shopCipher: "cph",
    });
    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("app_key")).toBe("k");
    expect(url.searchParams.get("timestamp")).toBe("1700000000");
    expect(url.searchParams.get("shop_cipher")).toBe("cph");
    expect(url.searchParams.get("sign")).toMatch(/^[0-9a-f]{64}$/);
    expect((init.headers as Record<string, string>)["x-tts-access-token"]).toBe("tok");
  });

  it("retries 5xx then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(503, { code: 1, message: "busy" }))
      .mockResolvedValueOnce(json(200, { code: 0, message: "ok", data: 1 }));
    await expect(makeClient(fetchMock).request({ method: "GET", path: "/x" })).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry business errors", async () => {
    const fetchMock = vi.fn(async () => json(200, { code: 105001, message: "bad", request_id: "r1" }));
    await expect(makeClient(fetchMock as unknown as typeof fetch).request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(TikTokApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OrdersApi.searchAll", () => {
  it("follows next_page_token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { code: 0, message: "", data: { orders: [{ id: "1" }], next_page_token: "p2" } }))
      .mockResolvedValueOnce(json(200, { code: 0, message: "", data: { orders: [{ id: "2" }], next_page_token: "" } }));
    const api = new OrdersApi(makeClient(fetchMock));
    const ids: string[] = [];
    for await (const o of api.searchAll({ accessToken: "t", shopCipher: "c" }, { page_size: 50 })) ids.push(o.id);
    expect(ids).toEqual(["1", "2"]);
  });
});
