# Roadmap & sprint plan

Two-week sprints. Each sprint is an **epic** issue labelled `epic` + `sprint-N`, and each story is a sub-issue
with the same sprint label and an area label. GitHub issues are the source of truth. This file is the overview.

| Sprint | Goal | Stories |
| --- | --- | --- |
| Sprint 0 — Foundation & API access | Repo, CI, Partner Center app and a verified signed call against sandbox. | 5 |
| Sprint 1 — Seller authorization & shops | A seller can connect one or more shops; tokens are stored and kept fresh. | 5 |
| Sprint 2 — Order ingestion | Every order from every connected shop lands in Postgres within minutes, idempotently. | 7 |
| Sprint 3 — OMS API & order UI | Ops staff can find, filter and inspect orders across shops. | 5 |
| Sprint 4 — Fulfillment | Ship orders from the OMS using TikTok Shipping labels or own 3PL. | 6 |
| Sprint 5 — Cancellations, returns & refunds | Handle the after-sales lifecycle inside the OMS. | 5 |
| Sprint 6 — Inventory, products & finance | Connect orders to SKUs and money. | 4 |
| Sprint 7 — Hardening & launch | Production-ready: observable, recoverable, reviewed. | 5 |

## Sprint 0 — Foundation & API access

**Goal:** Repo, CI, Partner Center app and a verified signed call against sandbox.

- [ ] **Register Partner Center app and sandbox shop** `infra` — Create the app in Partner Center, get app key/secret and service ID, request the scopes Order, Fulfillment, Return & Refund, Logistics, Product (read) and Authorization, and create a sandbox/test shop.
- [ ] **Verify request signing against the API testing tool** `sdk` — `signRequest` follows the 202309 algorithm from memory, because the docs could not be fetched at scaffold time. Validate it against Partner Center's API testing tool and the *Sign your API request* page.
- [ ] **CI pipeline: typecheck, test, build** `infra` — GitHub Actions on PR and push to main.
- [ ] **Token encryption at rest** `security` — AES-256-GCM helper in `packages/db` (or a shared crypto package) that uses `TOKEN_ENCRYPTION_KEY`, with key-rotation support (key id prefix).
- [ ] **Initial DB migration** `db` — Generate and commit the first Drizzle migration from `packages/db/src/schema.ts`.

## Sprint 1 — Seller authorization & shops

**Goal:** A seller can connect one or more shops; tokens are stored and kept fresh.

- [ ] **OAuth callback: exchange code for tokens** `auth` — Implement `/auth/tiktok/callback`: validate `state` (stored server-side with a TTL), call `AuthApi.getAccessToken`, and upsert `authorizations` keyed by `open_id`.
- [ ] **Fetch and store authorized shops (shop cipher)** `auth` — After the token exchange, call `AuthorizationApi.getAuthorizedShops` and upsert `shops` with `cipher` and region.
- [ ] **Token refresh scheduler** `worker` — A repeatable job that refreshes access tokens expiring within 24h through `AuthApi.refreshAccessToken`.
- [ ] **Handle deauthorization and reauthorization** `auth` — Handle the seller deauthorization webhook and API auth errors by marking the authorization revoked and stopping sync jobs for its shops. Reconnecting restores them.
- [ ] **Region-aware authorize link (US vs ROW)** `auth` — Support the US and ROW authorization entries and store the region on the authorization.

## Sprint 2 — Order ingestion

**Goal:** Every order from every connected shop lands in Postgres within minutes, idempotently.

- [ ] **Persist and dedupe inbound webhooks** `webhooks` — In `/webhooks/tiktok`, insert into `webhook_events` (unique `tts_notification_id`), enqueue a `tts-webhook` job, and return 200 quickly.
- [ ] **Subscribe shop webhooks via Events API** `webhooks` — On shop connect, ensure subscriptions exist for ORDER_STATUS_CHANGE, RECIPIENT_ADDRESS_UPDATE, PACKAGE_UPDATE, CANCELLATION_STATUS_CHANGE and RETURN_STATUS_CHANGE. Confirm the event type numbers in the Webhooks overview.
- [ ] **Order upsert service** `orders` — A `upsertOrders(shopId, Order[])` function that maps the TikTok Order to `orders` + `order_line_items` + `order_packages` in one transaction.
- [ ] **Webhook processor: order status change** `worker` — Process `ORDER_STATUS_CHANGE` / `RECIPIENT_ADDRESS_UPDATE` by fetching Get Order Detail (batched up to 50) and running the upsert.
- [ ] **Incremental order polling (backstop)** `worker` — Repeatable per-shop job that uses `orders/search` with `update_time_ge = cursor - 10 min`, sorted by `update_time ASC`, and advances `sync_cursors`.
- [ ] **Historical backfill on shop connect** `worker` — On first connect, backfill orders created in the last N days (configurable, default 90) in time-windowed chunks.
- [ ] **Per-shop rate limiting** `sdk` — A token bucket (Redis) per shop and API group, sized to the documented QPS limits, plus Retry-After handling.

## Sprint 3 — OMS API & order UI

**Goal:** Ops staff can find, filter and inspect orders across shops.

- [ ] **OMS user auth and RBAC** `api` — Login for internal users (OIDC or email magic link) with the roles admin, ops and viewer. PII fields are only visible to ops and above.
- [ ] **Orders REST API: list, filter, search, detail** `api` — `GET /v1/orders` with filters (shop, status, date range, SKU, buyer, SLA breach) and cursor pagination. `GET /v1/orders/:id` returns line items and packages.
- [ ] **Admin web app: order list and detail** `ui` — A Next.js (or Vite + React) app under `apps/web` with an order table, filters, a detail drawer and shop switcher.
- [ ] **Shop connection management UI** `ui` — A page to connect a shop, see connection/token status, last sync time and backfill progress, and trigger a re-sync.
- [ ] **Order export (CSV)** `api` — Export the filtered order list to CSV through a background job, with a download link.

## Sprint 4 — Fulfillment

**Goal:** Ship orders from the OMS using TikTok Shipping labels or own 3PL.

- [ ] **Package split/combine support** `fulfillment` — Read split attributes and support splitting an order into packages or combining eligible orders before shipping.
- [ ] **Ship package with TikTok Shipping (4PL)** `fulfillment` — Ship packages and generate labels with the platform logistics provider, including pickup/drop-off handover options.
- [ ] **Print shipping labels and packing slips** `fulfillment` — Fetch shipping documents (label, packing slip) per package and merge them into one PDF for batch printing.
- [ ] **Seller-shipped (3PL) tracking upload** `fulfillment` — For seller-shipped orders, pick a shipping provider (Logistics API) and upload tracking numbers, singly or by CSV.
- [ ] **PACKAGE_UPDATE webhook handling** `webhooks` — Update `packages` status and tracking from PACKAGE_UPDATE pushes and order detail.
- [ ] **Warehouse and delivery option sync** `fulfillment` — Sync seller warehouses and delivery options from the Logistics API for use in shipping flows.

## Sprint 5 — Cancellations, returns & refunds

**Goal:** Handle the after-sales lifecycle inside the OMS.

- [ ] **Sync cancellations** `after-sales` — Store cancellation requests (webhook CANCELLATION_STATUS_CHANGE plus a search poll backstop) linked to orders.
- [ ] **Approve/reject buyer cancellations** `after-sales` — Actions for approve and reject (with a reason) from the UI.
- [ ] **Seller-initiated cancellation** `after-sales` — Allow sellers to cancel unfulfilled orders or line items (e.g. out of stock) with a reason.
- [ ] **Sync returns and refunds** `after-sales` — Store return/refund requests (RETURN_STATUS_CHANGE webhook plus search poll) with their status timeline.
- [ ] **Approve/reject returns and refunds** `after-sales` — Review actions for returns, including partial refunds where supported.

## Sprint 6 — Inventory, products & finance

**Goal:** Connect orders to SKUs and money.

- [ ] **Product and SKU catalog sync (read)** `catalog` — Sync products/SKUs (Product API search), and map `seller_sku` to internal SKUs.
- [ ] **Inventory push to TikTok** `catalog` — Update inventory per SKU and warehouse from the OMS stock source, and decrement on order allocation.
- [ ] **Finance: statements and settlements** `finance` — Sync statements, payments and per-order transactions from the Finance API for reconciliation.
- [ ] **Reports: sales, fulfillment SLA, cancellations** `ui` — Dashboards for orders/day, GMV by shop, late-shipment rate and cancellation/return rate.

## Sprint 7 — Hardening & launch

**Goal:** Production-ready: observable, recoverable, reviewed.

- [ ] **Observability: logs, metrics, alerts** `infra` — Structured logs with `request_id` from TikTok responses, metrics (API latency/errors per endpoint, queue depth, webhook lag) and alerting.
- [ ] **Reconciliation job and DLQ replay** `worker` — A nightly job that compares order counts/statuses against the API per shop and day, plus tooling to replay dead-lettered webhook jobs.
- [ ] **Security review and PII handling** `security` — Review secrets, token storage, webhook verification, PII retention (purge recipient data after N days per TikTok data policy) and access logs.
- [ ] **Load test and capacity plan** `infra` — Simulate a peak sales event (10x webhooks plus backfill) against staging.
- [ ] **Production deployment and App Market readiness** `infra` — Deploy pipeline (staging → prod), migrations on deploy, runbooks, and the App & Service Market listing/review if distributing to other sellers.

## Definition of done

- Typecheck, tests and build green in CI
- New TTS endpoints verified against the reference page and its newest supported version (see `packages/tiktok-sdk/src/versions.ts`)
- Write actions against TikTok are audit logged
- No secrets or PII in logs
