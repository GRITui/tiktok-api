# Roadmap & sprint plan

Two-week sprints. Each sprint is an **epic** issue labelled `epic` + `sprint-N`, and each story is a sub-issue
with the same sprint label and an area label. GitHub issues are the source of truth. This file is the overview.

### Labels

| Label | Meaning |
| --- | --- |
| `epic` / `story` | Sprint epic or a story inside it (stories are sub-issues of their epic) |
| `sprint-0` … `sprint-8` | Planned sprint |
| `auth`, `orders`, `fulfillment`, `after-sales`, `catalog`, `finance` | Business area |
| `sdk`, `db`, `api`, `ui`, `worker`, `webhooks`, `infra`, `security` | Layer / component |
| `P0` / `P1` / `P2` | Must have for the sprint goal / should have / can slip *(fulfillment sprints)* |
| `size:S` / `size:M` | ≤ 2 days / 3–4 days *(fulfillment sprints)* |
| `ship:tiktok` / `ship:seller` / `ship:fbt` | Applies only to TikTok Shipping, seller (own carrier) shipping, or Fulfilled by TikTok |

| Sprint | Goal | Stories |
| --- | --- | --- |
| [Sprint 0 — Foundation & API access](https://github.com/GRITui/tiktok-api/issues/1) | Repo, CI, Partner Center app and a verified signed call against sandbox. | 5 |
| [Sprint 1 — Seller authorization & shops](https://github.com/GRITui/tiktok-api/issues/2) | A seller can connect one or more shops; tokens are stored and kept fresh. | 5 |
| [Sprint 2 — Order ingestion](https://github.com/GRITui/tiktok-api/issues/3) | Every order from every connected shop lands in Postgres within minutes, idempotently. | 7 |
| [Sprint 3 — OMS API & order UI](https://github.com/GRITui/tiktok-api/issues/4) | Ops staff can find, filter and inspect orders across shops. | 5 |
| [Sprint 4 — Fulfillment I: TikTok Shipping](https://github.com/GRITui/tiktok-api/issues/5) | Ship and label orders with TikTok Shipping, singly or in bulk. | 12 |
| [Sprint 5 — Fulfillment II: Seller shipping & exceptions](https://github.com/GRITui/tiktok-api/issues/51) | Own-carrier shipping, split/combine, pick/pack, SLA alerts, exceptions, FBT. | 12 |
| [Sprint 6 — Cancellations, returns & refunds](https://github.com/GRITui/tiktok-api/issues/6) | Handle the after-sales lifecycle inside the OMS. | 5 |
| [Sprint 7 — Inventory, products & finance](https://github.com/GRITui/tiktok-api/issues/7) | Connect orders to SKUs and money. | 4 |
| [Sprint 8 — Hardening & launch](https://github.com/GRITui/tiktok-api/issues/8) | Production-ready: observable, recoverable, reviewed. | 5 |

## Sprint 0 — Foundation & API access (#1)

**Goal:** Repo, CI, Partner Center app and a verified signed call against sandbox.

- [ ] #9 **Register Partner Center app and sandbox shop** `infra` — Create the app in Partner Center, get app key/secret and service ID, request the scopes Order, Fulfillment, Return & Refund, Logistics, Product (read) and Authorization, and create a sandbox/test shop.
- [ ] #10 **Verify request signing against the API testing tool** `sdk` — `signRequest` follows the 202309 algorithm from memory, because the docs could not be fetched at scaffold time. Validate it against Partner Center's API testing tool and the *Sign your API request* page.
- [ ] #13 **CI pipeline: typecheck, test, build** `infra` — GitHub Actions on PR and push to main.
- [ ] #11 **Token encryption at rest** `security` — AES-256-GCM helper in `packages/db` (or a shared crypto package) that uses `TOKEN_ENCRYPTION_KEY`, with key-rotation support (key id prefix).
- [ ] #12 **Initial DB migration** `db` — Generate and commit the first Drizzle migration from `packages/db/src/schema.ts`.

## Sprint 1 — Seller authorization & shops (#2)

**Goal:** A seller can connect one or more shops; tokens are stored and kept fresh.

- [ ] #14 **OAuth callback: exchange code for tokens** `auth` — Implement `/auth/tiktok/callback`: validate `state` (stored server-side with a TTL), call `AuthApi.getAccessToken`, and upsert `authorizations` keyed by `open_id`.
- [ ] #15 **Fetch and store authorized shops (shop cipher)** `auth` — After the token exchange, call `AuthorizationApi.getAuthorizedShops` and upsert `shops` with `cipher` and region.
- [ ] #16 **Token refresh scheduler** `worker` — A repeatable job that refreshes access tokens expiring within 24h through `AuthApi.refreshAccessToken`.
- [ ] #17 **Handle deauthorization and reauthorization** `auth` — Handle the seller deauthorization webhook and API auth errors by marking the authorization revoked and stopping sync jobs for its shops. Reconnecting restores them.
- [ ] #18 **Region-aware authorize link (US vs ROW)** `auth` — Support the US and ROW authorization entries and store the region on the authorization.

## Sprint 2 — Order ingestion (#3)

**Goal:** Every order from every connected shop lands in Postgres within minutes, idempotently.

- [ ] #19 **Persist and dedupe inbound webhooks** `webhooks` — In `/webhooks/tiktok`, insert into `webhook_events` (unique `tts_notification_id`), enqueue a `tts-webhook` job, and return 200 quickly.
- [ ] #20 **Subscribe shop webhooks via Events API** `webhooks` — On shop connect, ensure subscriptions exist for ORDER_STATUS_CHANGE, RECIPIENT_ADDRESS_UPDATE, PACKAGE_UPDATE, CANCELLATION_STATUS_CHANGE and RETURN_STATUS_CHANGE. Confirm the event type numbers in the Webhooks overview.
- [ ] #21 **Order upsert service** `orders` — A `upsertOrders(shopId, Order[])` function that maps the TikTok Order to `orders` + `order_line_items` + `order_packages` in one transaction.
- [ ] #22 **Webhook processor: order status change** `worker` — Process `ORDER_STATUS_CHANGE` / `RECIPIENT_ADDRESS_UPDATE` by fetching Get Order Detail (batched up to 50) and running the upsert.
- [ ] #23 **Incremental order polling (backstop)** `worker` — Repeatable per-shop job that uses `orders/search` with `update_time_ge = cursor - 10 min`, sorted by `update_time ASC`, and advances `sync_cursors`.
- [ ] #24 **Historical backfill on shop connect** `worker` — On first connect, backfill orders created in the last N days (configurable, default 90) in time-windowed chunks.
- [ ] #25 **Per-shop rate limiting** `sdk` — A token bucket (Redis) per shop and API group, sized to the documented QPS limits, plus Retry-After handling.

## Sprint 3 — OMS API & order UI (#4)

**Goal:** Ops staff can find, filter and inspect orders across shops.

- [ ] #26 **OMS user auth and RBAC** `api` — Login for internal users (OIDC or email magic link) with the roles admin, ops and viewer. PII fields are only visible to ops and above.
- [ ] #27 **Orders REST API: list, filter, search, detail** `api` — `GET /v1/orders` with filters (shop, status, date range, SKU, buyer, SLA breach) and cursor pagination. `GET /v1/orders/:id` returns line items and packages.
- [ ] #28 **Admin web app: order list and detail** `ui` — A Next.js (or Vite + React) app under `apps/web` with an order table, filters, a detail drawer and shop switcher.
- [ ] #29 **Shop connection management UI** `ui` — A page to connect a shop, see connection/token status, last sync time and backfill progress, and trigger a re-sync.
- [ ] #30 **Order export (CSV)** `api` — Export the filtered order list to CSV through a background job, with a download link.

## Sprint 4 — Fulfillment I: TikTok Shipping end-to-end (#5)

**Goal:** Ops can take an AWAITING_SHIPMENT order, ship it with TikTok Shipping (platform logistics) and print its label, singly or in bulk.

Listed in suggested build order: data and SDK first, then the shared guards, then the ship flows and UI.

| # | Story | Layer | Priority | Size | Mode |
| --- | --- | --- | --- | --- | --- |
| #36 | Warehouse, delivery option & shipping provider sync | `worker` | P0 | M | — |
| #52 | SDK: package and shipping endpoints | `sdk` | P0 | M | — |
| #53 | Package data model and order–package sync | `db` | P0 | M | — |
| #35 | PACKAGE_UPDATE webhook handling | `webhooks` | P0 | S | — |
| #59 | Idempotency and audit for fulfillment actions | `api` | P0 | S | — |
| #54 | Pre-ship validation guard | `api` | P0 | S | — |
| #55 | "To ship" queue API | `api` | P0 | S | — |
| #32 | Ship a package with TikTok Shipping (single) | `api` | P0 | M | tiktok |
| #58 | Batch ship job with partial-failure handling | `worker` | P0 | M | tiktok |
| #33 | Print shipping labels and packing slips (batch PDF) | `worker` | P0 | M | tiktok |
| #56 | Fulfillment workbench UI | `ui` | P0 | M | — |
| #57 | Handover method and pickup time slots | `api` | P1 | S | tiktok |

## Sprint 5 — Fulfillment II: Seller shipping, split/combine & exceptions (#51)

**Goal:** Own-carrier (seller) shipping, package split/combine, internal pick/pack, SLA alerts, exception handling and FBT visibility, verified by an end-to-end sandbox suite.

| # | Story | Layer | Priority | Size | Mode |
| --- | --- | --- | --- | --- | --- |
| #34 | Ship with own carrier (seller shipping): provider + tracking | `api` | P0 | M | seller |
| #69 | Fulfillment end-to-end tests against sandbox | `infra` | P0 | M | — |
| #31 | Split an order into multiple packages | `api` | P1 | M | — |
| #62 | Combine and uncombine packages | `api` | P1 | M | — |
| #60 | Bulk tracking import (CSV) for seller shipping | `ui` | P1 | S | seller |
| #61 | Correct tracking info after shipping | `api` | P1 | S | seller |
| #63 | Pick lists and internal pick/pack states | `api` | P1 | M | — |
| #65 | Ship-by SLA alerts and late-shipment metric | `worker` | P1 | S | — |
| #66 | Fulfillment exception queue | `worker` | P1 | M | — |
| #64 | Scan-to-verify packing | `ui` | P2 | M | — |
| #67 | Fulfilled by TikTok (FBT) orders: read-only view | `api` | P2 | S | fbt |
| #68 | Proof of delivery upload (where required) | `api` | P2 | S | seller |

## Sprint 6 — Cancellations, returns & refunds (#6)

**Goal:** Handle the after-sales lifecycle inside the OMS.

- [ ] #37 **Sync cancellations** `after-sales` — Store cancellation requests (webhook CANCELLATION_STATUS_CHANGE plus a search poll backstop) linked to orders.
- [ ] #38 **Approve/reject buyer cancellations** `after-sales` — Actions for approve and reject (with a reason) from the UI.
- [ ] #39 **Seller-initiated cancellation** `after-sales` — Allow sellers to cancel unfulfilled orders or line items (e.g. out of stock) with a reason.
- [ ] #40 **Sync returns and refunds** `after-sales` — Store return/refund requests (RETURN_STATUS_CHANGE webhook plus search poll) with their status timeline.
- [ ] #41 **Approve/reject returns and refunds** `after-sales` — Review actions for returns, including partial refunds where supported.

## Sprint 7 — Inventory, products & finance (#7)

**Goal:** Connect orders to SKUs and money.

- [ ] #42 **Product and SKU catalog sync (read)** `catalog` — Sync products/SKUs (Product API search), and map `seller_sku` to internal SKUs.
- [ ] #43 **Inventory push to TikTok** `catalog` — Update inventory per SKU and warehouse from the OMS stock source, and decrement on order allocation.
- [ ] #44 **Finance: statements and settlements** `finance` — Sync statements, payments and per-order transactions from the Finance API for reconciliation.
- [ ] #45 **Reports: sales, fulfillment SLA, cancellations** `ui` — Dashboards for orders/day, GMV by shop, late-shipment rate and cancellation/return rate.

## Sprint 8 — Hardening & launch (#8)

**Goal:** Production-ready: observable, recoverable, reviewed.

- [ ] #46 **Observability: logs, metrics, alerts** `infra` — Structured logs with `request_id` from TikTok responses, metrics (API latency/errors per endpoint, queue depth, webhook lag) and alerting.
- [ ] #47 **Reconciliation job and DLQ replay** `worker` — A nightly job that compares order counts/statuses against the API per shop and day, plus tooling to replay dead-lettered webhook jobs.
- [ ] #48 **Security review and PII handling** `security` — Review secrets, token storage, webhook verification, PII retention (purge recipient data after N days per TikTok data policy) and access logs.
- [ ] #49 **Load test and capacity plan** `infra` — Simulate a peak sales event (10x webhooks plus backfill) against staging.
- [ ] #50 **Production deployment and App Market readiness** `infra` — Deploy pipeline (staging → prod), migrations on deploy, runbooks, and the App & Service Market listing/review if distributing to other sellers.

## Definition of done

- Typecheck, tests and build green in CI
- New TTS endpoints verified against the reference page and its newest supported version (see `packages/tiktok-sdk/src/versions.ts`)
- Write actions against TikTok are audit logged
- No secrets or PII in logs
