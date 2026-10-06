import type { TikTokClient } from "../client.js";
import { API_VERSIONS } from "../versions.js";
import type { ShopContext } from "./orders.js";

const V = API_VERSIONS.event;

/* Events API (202309) — shop webhook subscriptions. LANE D (#20) verifies against the reference page. */

export interface ShopWebhook {
  event_type: string;
  address: string;
  create_time?: number;
}

export class EventsApi {
  constructor(private readonly client: TikTokClient) {}

  async getShopWebhooks(ctx: ShopContext): Promise<ShopWebhook[]> {
    const d = await this.client.request<{ webhooks?: ShopWebhook[] }>({ method: "GET", path: `/event/${V}/webhooks`, ...ctx });
    return d.webhooks ?? [];
  }

  updateShopWebhook(ctx: ShopContext, body: { event_type: string; address: string }): Promise<void> {
    return this.client.request({ method: "PUT", path: `/event/${V}/webhooks`, body, ...ctx });
  }

  deleteShopWebhook(ctx: ShopContext, body: { event_type: string }): Promise<void> {
    return this.client.request({ method: "DELETE", path: `/event/${V}/webhooks`, body, ...ctx });
  }
}
