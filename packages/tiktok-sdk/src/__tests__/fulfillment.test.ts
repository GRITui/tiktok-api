import { describe, expect, it, vi } from "vitest";
import { FulfillmentApi, slotAvailable } from "../endpoints/fulfillment.js";
import { TikTokClient } from "../client.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function makeClient(fetchMock: typeof fetch) {
  return new TikTokClient({ appKey: "k", appSecret: "s", fetch: fetchMock, now: () => 1_700_000_000_000, sleep: async () => {} });
}

const ctx = { accessToken: "t", shopCipher: "c" };

describe("FulfillmentApi", () => {
  it("getPackageDetail sends GET request", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        code: 0,
        message: "Success",
        data: { package_id: "pkg1", package_status: "AWAITING_SHIPMENT" },
      }),
    );
    const api = new FulfillmentApi(makeClient(fetchMock));
    const result = await api.getPackageDetail(ctx, "pkg1");
    expect(result.package_id).toBe("pkg1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/fulfillment/202309/packages/pkg1");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-tts-access-token"]).toBe("t");
    expect(url.searchParams.get("shop_cipher")).toBe("c");
  });

  it("getHandoverTimeSlots sends GET request", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        code: 0,
        message: "Success",
        data: { can_pickup: true, can_drop_off: false, pickup_slots: [{ start_time: 1000, end_time: 2000, available: true }] },
      }),
    );
    const api = new FulfillmentApi(makeClient(fetchMock));
    const result = await api.getHandoverTimeSlots(ctx, "pkg1");
    expect(result.can_pickup).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/fulfillment/202309/packages/pkg1/handover_time_slots");
    expect(init.method).toBe("GET");
  });

  it("shipPackage sends POST request with body", async () => {
    const fetchMock = vi.fn(async () => json(200, { code: 0, message: "Success", data: {} }));
    const api = new FulfillmentApi(makeClient(fetchMock));
    await api.shipPackage(ctx, "pkg1", { handover_method: "PICKUP", pickup_slot: { start_time: 1000, end_time: 2000 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/fulfillment/202309/packages/pkg1/ship");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ handover_method: "PICKUP", pickup_slot: { start_time: 1000, end_time: 2000 } });
  });

  it("batchShipPackages sends POST request", async () => {
    const fetchMock = vi.fn(async () => json(200, { code: 0, message: "Success", data: { errors: [] } }));
    const api = new FulfillmentApi(makeClient(fetchMock));
    const result = await api.batchShipPackages(ctx, { packages: [{ id: "pkg1", handover_method: "PICKUP" }] });
    expect(result.errors).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/fulfillment/202309/packages/ship");
    expect(init.method).toBe("POST");
  });

  it("getPackageShippingDocument sends GET request with query params", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { code: 0, message: "Success", data: { doc_url: "https://example.com/doc.pdf", tracking_number: "TRK123" } }),
    );
    const api = new FulfillmentApi(makeClient(fetchMock));
    const result = await api.getPackageShippingDocument(ctx, "pkg1", { document_type: "SHIPPING_LABEL", document_format: "PDF" });
    expect(result.doc_url).toBe("https://example.com/doc.pdf");
    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/fulfillment/202309/packages/pkg1/shipping_documents");
    expect(url.searchParams.get("document_type")).toBe("SHIPPING_LABEL");
    expect(url.searchParams.get("document_format")).toBe("PDF");
  });
});

describe("slotAvailable helper", () => {
  it("normalizes 'avaliable' typo to 'available'", () => {
    expect(slotAvailable({ start_time: 1000, end_time: 2000, avaliable: true })).toBe(true);
  });

  it("uses 'available' when present", () => {
    expect(slotAvailable({ start_time: 1000, end_time: 2000, available: true })).toBe(true);
    expect(slotAvailable({ start_time: 1000, end_time: 2000, available: false })).toBe(false);
  });

  it("defaults to false when neither is present", () => {
    expect(slotAvailable({ start_time: 1000, end_time: 2000 })).toBe(false);
  });
});
