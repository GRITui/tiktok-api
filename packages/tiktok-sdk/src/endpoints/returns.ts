import type { TikTokClient } from "../client.js";
import { API_VERSIONS } from "../versions.js";
import type { ShopContext } from "./orders.js";

const V = API_VERSIONS.returnRefund;

export class ReturnsApi {
  constructor(private readonly client: TikTokClient) {}

  searchCancellations(ctx: ShopContext, query: { page_size: number; page_token?: string }, body: Record<string, unknown> = {}) {
    return this.client.request<unknown>({ method: "POST", path: `/return_refund/${V}/cancellations/search`, query, body, ...ctx });
  }

  approveCancellation(ctx: ShopContext, cancelId: string) {
    return this.client.request<unknown>({ method: "POST", path: `/return_refund/${V}/cancellations/${cancelId}/approve`, body: {}, ...ctx });
  }

  rejectCancellation(ctx: ShopContext, cancelId: string, body: { reject_reason: string; comment?: string }) {
    return this.client.request<unknown>({ method: "POST", path: `/return_refund/${V}/cancellations/${cancelId}/reject`, body, ...ctx });
  }

  searchReturns(ctx: ShopContext, query: { page_size: number; page_token?: string }, body: Record<string, unknown> = {}) {
    return this.client.request<unknown>({ method: "POST", path: `/return_refund/${V}/returns/search`, query, body, ...ctx });
  }
}
