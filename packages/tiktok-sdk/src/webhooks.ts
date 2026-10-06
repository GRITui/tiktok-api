/**
 * Webhook event types relevant to an OMS. Numeric values are what TikTok sends in `type`.
 * VERIFY against "Webhooks overview" — subscribe via Events API or Partner Center.
 */
export const WebhookType = {
  ORDER_STATUS_CHANGE: 1,
  RECIPIENT_ADDRESS_UPDATE: 3,
  PACKAGE_UPDATE: 4,
  PRODUCT_STATUS_CHANGE: 5,
  /** Seller revoked the app authorization. VERIFY number. */
  SELLER_DEAUTHORIZATION: 6,
  CANCELLATION_STATUS_CHANGE: 11,
  RETURN_STATUS_CHANGE: 12,
} as const;

export type WebhookTypeValue = (typeof WebhookType)[keyof typeof WebhookType];

export interface WebhookEnvelope<T = Record<string, unknown>> {
  type: number;
  tts_notification_id: string;
  shop_id: string;
  timestamp: number;
  data: T;
}

export interface OrderStatusChangeData {
  order_id: string;
  order_status: string;
  update_time: number;
}
