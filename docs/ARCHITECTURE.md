# Architecture

```
            ┌──────────────── TikTok Shop Open Platform ────────────────┐
            │  auth.tiktok-shops.com      open-api.tiktokglobalshop.com │
            └──────▲───────────────┬──────────────▲───────────────┬─────┘
        token get/ │      webhooks │   signed API │ calls         │ seller authorize
        refresh    │     (push)    ▼              │               ▼ redirect (code,state)
            ┌──────┴───────────────────┐   ┌──────┴──────────────────────┐
            │ apps/api (Fastify)       │   │ apps/worker (BullMQ)        │
            │ - /auth/tiktok/*         │   │ - webhook processor         │
            │ - /webhooks/tiktok       ├──►│ - order sync (poll)         │
            │ - /v1/orders ... (OMS)   │ Q │ - token refresh             │
            └──────┬───────────────────┘   │ - fulfillment actions       │
                   │                       └──────┬──────────────────────┘
                   ▼                              ▼
            ┌─────────────────────────────────────────────┐   ┌────────┐
            │ Postgres: authorizations, shops, orders,    │   │ Redis  │
            │ line items, packages, webhook_events,       │   │ queues │
            │ sync_cursors, audit_log                     │   └────────┘
            └─────────────────────────────────────────────┘
```

## Key TTS API concepts

| Concept | How the OMS handles it |
| --- | --- |
| **App key/secret** | Env vars; secret never leaves the server. |
| **Seller authorization** | `/auth/tiktok/connect` redirects to the region's authorize URL (US: `services.us.tiktokshop.com`, ROW: `services.tiktokshop.com`). Callback exchanges `code` → tokens. |
| **Access / refresh tokens** | Stored encrypted per `open_id` in `authorizations`. Worker refreshes ahead of `access_token_expire_in`. |
| **Shop cipher** | From *Get Authorized Shops*; required as `shop_cipher` on every shop-scoped call. Stored on `shops`. |
| **Signing** | Every Open API call carries `app_key`, `timestamp`, `sign` (HMAC-SHA256). See `packages/tiktok-sdk/src/signing.ts`. |
| **Versioning** | Versions are per endpoint (`/order/202309/...`). Pinned centrally in `versions.ts`; check each reference page before bumping. |
| **Webhooks** | Verified, stored raw in `webhook_events` (dedupe on `tts_notification_id`), ACKed immediately, processed async. |
| **Rate limits** | Client retries 429/5xx with backoff; Sprint 2 adds per-shop/per-endpoint token buckets. |

## Order ingestion strategy

Webhooks are the primary trigger and polling is the backstop:

1. **Webhook** `ORDER_STATUS_CHANGE`: enqueue *fetch order detail* → upsert.
2. **Incremental poll** every N minutes per shop: `orders/search` with `update_time_ge = cursor - overlap`, sorted by
   `update_time ASC`, so missed or out-of-order webhooks are still captured.
3. **Backfill** on first connect: page through the last X days by `create_time`.
4. **Upsert rule:** write only if incoming `update_time` ≥ stored `tts_updated_at`. This makes all paths idempotent.

## Order lifecycle (TikTok statuses)

`UNPAID → ON_HOLD → AWAITING_SHIPMENT → (PARTIALLY_SHIPPING) → AWAITING_COLLECTION → IN_TRANSIT → DELIVERED → COMPLETED`,
with `CANCELLED` reachable from pre-shipment states. The OMS shows TikTok's status as the source of truth and layers
internal workflow states (e.g. picked, packed) on top in a separate column.

## Security

- Tokens are encrypted at rest (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`).
- Webhook HMAC is verified with constant-time compare.
- PII (recipient address, phone) is scoped by role in the OMS API and redacted from logs.
- Every write action against TikTok goes to `audit_log`.
