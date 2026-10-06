import type { TikTokClient } from "../client.js";
import type { Order, SearchOrdersBody, SearchOrdersQuery, SearchOrdersResponse } from "../types.js";
import { API_VERSIONS } from "../versions.js";

export interface ShopContext {
  accessToken: string;
  shopCipher: string;
}

/** Max order IDs accepted by Get Order Detail in a single call. */
export const ORDER_DETAIL_BATCH_SIZE = 50;

export class OrdersApi {
  constructor(private readonly client: TikTokClient) {}

  search(ctx: ShopContext, query: SearchOrdersQuery, body: SearchOrdersBody = {}): Promise<SearchOrdersResponse> {
    return this.client.request({
      method: "POST",
      path: `/order/${API_VERSIONS.order}/orders/search`,
      query: { ...query },
      body,
      ...ctx,
    });
  }

  /** Iterate every page of a search. */
  async *searchAll(ctx: ShopContext, query: Omit<SearchOrdersQuery, "page_token">, body: SearchOrdersBody = {}) {
    let pageToken: string | undefined;
    do {
      const page = await this.search(ctx, { ...query, page_token: pageToken }, body);
      for (const order of page.orders ?? []) yield order;
      pageToken = page.next_page_token || undefined;
    } while (pageToken);
  }

  async getDetails(ctx: ShopContext, orderIds: string[]): Promise<Order[]> {
    const out: Order[] = [];
    for (let i = 0; i < orderIds.length; i += ORDER_DETAIL_BATCH_SIZE) {
      const ids = orderIds.slice(i, i + ORDER_DETAIL_BATCH_SIZE);
      const data = await this.client.request<{ orders?: Order[] }>({
        method: "GET",
        path: `/order/${API_VERSIONS.order}/orders`,
        query: { ids: ids.join(",") },
        ...ctx,
      });
      out.push(...(data.orders ?? []));
    }
    return out;
  }
}
