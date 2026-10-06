import type { TikTokClient } from "../client.js";
import { API_VERSIONS } from "../versions.js";
import type { ShopContext } from "./orders.js";

const V = API_VERSIONS.logistics;

/* Logistics API (202309). LANE F1 (#36) verifies paths/fields against the reference pages. */

export interface Warehouse {
  id: string;
  name: string;
  effect_status?: string;
  type?: string;
  sub_type?: string;
  is_default?: boolean;
  address?: Record<string, unknown>;
}

export interface DeliveryOption {
  id: string;
  name: string;
  type?: string;
  description?: string;
}

export interface ShippingProvider {
  id: string;
  name: string;
}

export class LogisticsApi {
  constructor(private readonly client: TikTokClient) {}

  async getWarehouses(ctx: ShopContext): Promise<Warehouse[]> {
    const d = await this.client.request<{ warehouses?: Warehouse[] }>({ method: "GET", path: `/logistics/${V}/warehouses`, ...ctx });
    return d.warehouses ?? [];
  }

  async getWarehouseDeliveryOptions(ctx: ShopContext, warehouseId: string): Promise<DeliveryOption[]> {
    const d = await this.client.request<{ delivery_options?: DeliveryOption[] }>({
      method: "GET",
      path: `/logistics/${V}/warehouses/${warehouseId}/delivery_options`,
      ...ctx,
    });
    return d.delivery_options ?? [];
  }

  async getShippingProviders(ctx: ShopContext, deliveryOptionId: string): Promise<ShippingProvider[]> {
    const d = await this.client.request<{ shipping_providers?: ShippingProvider[] }>({
      method: "GET",
      path: `/logistics/${V}/delivery_options/${deliveryOptionId}/shipping_providers`,
      ...ctx,
    });
    return d.shipping_providers ?? [];
  }
}
