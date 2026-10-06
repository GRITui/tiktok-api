/** Envelope every Open API response is wrapped in. `code === 0` means success. */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data?: T;
}

export type Region = "US" | "ROW";

export interface TokenResponse {
  access_token: string;
  /** Unix seconds at which the access token expires. */
  access_token_expire_in: number;
  refresh_token: string;
  refresh_token_expire_in: number;
  open_id: string;
  seller_name: string;
  seller_base_region: string;
  /** Authorization principal: seller, creator or partner. */
  user_type: number;
  granted_scopes?: string[];
}

export interface AuthorizedShop {
  id: string;
  name: string;
  region: string;
  seller_type: string;
  /** Opaque shop identifier required as `shop_cipher` on shop-scoped calls. */
  cipher: string;
  code: string;
}

export type OrderStatus =
  | "UNPAID"
  | "ON_HOLD"
  | "AWAITING_SHIPMENT"
  | "PARTIALLY_SHIPPING"
  | "AWAITING_COLLECTION"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

export interface Money {
  currency: string;
  sub_total?: string;
  shipping_fee?: string;
  seller_discount?: string;
  platform_discount?: string;
  total_amount?: string;
  tax?: string;
}

export interface LineItem {
  id: string;
  product_id: string;
  product_name: string;
  sku_id: string;
  sku_name?: string;
  seller_sku?: string;
  sale_price: string;
  original_price?: string;
  currency: string;
  display_status?: string;
  package_id?: string;
  tracking_number?: string;
  shipping_provider_name?: string;
  cancel_reason?: string;
  is_gift?: boolean;
}

export interface RecipientAddress {
  name?: string;
  phone_number?: string;
  full_address?: string;
  postal_code?: string;
  region_code?: string;
  district_info?: { address_level_name: string; address_name: string }[];
}

/** Subset of the Order object; extend as fields are needed. */
export interface Order {
  id: string;
  status: OrderStatus;
  create_time: number;
  update_time: number;
  paid_time?: number;
  rts_sla_time?: number;
  tts_sla_time?: number;
  fulfillment_type?: string;
  delivery_option_name?: string;
  shipping_type?: string;
  buyer_message?: string;
  user_id?: string;
  payment: Money;
  recipient_address?: RecipientAddress;
  line_items: LineItem[];
  packages?: { id: string }[];
  warehouse_id?: string;
  is_cod?: boolean;
  is_sample_order?: boolean;
}

export interface SearchOrdersQuery {
  page_size: number;
  page_token?: string;
  sort_field?: "create_time" | "update_time";
  sort_order?: "ASC" | "DESC";
}

export interface SearchOrdersBody {
  order_status?: OrderStatus;
  create_time_ge?: number;
  create_time_lt?: number;
  update_time_ge?: number;
  update_time_lt?: number;
  shipping_type?: string;
  buyer_user_id?: string;
}

export interface SearchOrdersResponse {
  orders?: Order[];
  next_page_token?: string;
  total_count?: number;
}
