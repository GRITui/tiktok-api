# Delivery plan: Sprints 0–4 in parallel lanes

Sprints 0–4 are built by six parallel lanes on top of a shared groundwork commit ("wave 0").
Wave 0 fixes every cross-lane contract up front, so lanes never edit each other's files.

## Wave 0 (done by the orchestrator)

| Issue | What |
| --- | --- |
| #11 | `TokenCipher` (AES-256-GCM, key rotation) in `packages/core/src/crypto.ts` |
| #12 | Full schema `packages/db/src/schema.ts` + `migrations/0000_init.sql`, `pnpm db:migrate` |
| #13 | CI with Postgres + Redis services, migrate step |
| — | `@oms/core` package: `Deps`, queues, runtime, test helpers, and **contract stubs** for every lane |
| — | SDK contracts: `endpoints/fulfillment.ts`, `logistics.ts`, `events.ts` |
| — | API wiring (`app.ts`, auth/session plugin, error handler, route stub per lane) and worker processors/schedules |

Not codeable here (human): **#9** register the Partner Center app and sandbox shop; **#10** verify signing against the
API testing tool (needs credentials and the docs site).

## Lanes

| Lane | Issues | Owns (may edit) |
| --- | --- | --- |
| **C — Auth & shops** | #14 #15 #16 #17 #18 | `packages/core/src/auth/**`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/v1/shops.ts` |
| **D — Ingestion** | #19 #20 #21 #22 #23 #24 #25 (+#53 package upsert) | `packages/core/src/orders/**`, `packages/tiktok-sdk/src/client.ts`, `packages/tiktok-sdk/src/endpoints/{orders,events}.ts`, `apps/api/src/routes/webhooks.ts` |
| **E1 — OMS API** | #26 #27 #30 #55 | `packages/core/src/oms/**` (not `types.ts`), `apps/api/src/routes/v1/{auth,orders,jobs,queue}.ts`, `apps/api/src/cli/**` |
| **E2 — Web app** | #28 #29 #56 | `apps/web/**` |
| **F1 — Logistics & handover** | #52 #36 #57 #35 | `packages/tiktok-sdk/src/endpoints/{fulfillment,logistics}.ts`, `packages/core/src/logistics/**`, `apps/api/src/routes/v1/logistics.ts` |
| **F2 — Ship & labels** | #59 #54 #32 #58 #33 | `packages/core/src/fulfillment/**`, `apps/api/src/routes/v1/fulfillment.ts` |

Every lane may add test files next to the code it owns. Frozen for all lanes (ask the orchestrator instead):
`packages/db/**`, `packages/core/src/{context,queues,runtime,testing,crypto,errors,index}.ts`,
`packages/core/src/oms/types.ts`, `apps/api/src/{app,index}.ts`, `apps/api/src/plugins/**`, `apps/worker/**`,
all `package.json` files except `apps/web/package.json`, and `pnpm-lock.yaml`.

## Contracts

- **Function contracts:** the stub files in `packages/core/src/{auth,orders,oms,logistics,fulfillment}/index.ts`.
  Replace the bodies; keep names, parameters and return types.
- **HTTP contract:** comments in each `apps/api/src/routes/**` stub plus DTOs in `packages/core/src/oms/types.ts`.
- **Cross-lane calls:** import from the module path (e.g. `../auth/index.js`). In tests, stub other lanes with
  `vi.mock("../auth/index.js", ...)`; their real implementations arrive at integration.

## Integration (orchestrator)

Merge lanes in order D → C → F1 → F2 → E1 → E2, regenerate the lockfile, wire the Redis rate limiter into
`runtime.ts`, then run typecheck, tests, migrations against real Postgres, and a smoke test of API + worker.

## Integration result

All six lanes merged. 232 tests pass (`REDIS_URL` set), typecheck and build are green.

End-to-end smoke test (built API + worker, real Postgres 16 + Redis 7, mock TikTok server that verifies request
signatures): admin login → connect shop (state reuse rejected, tokens stored encrypted) → shops, warehouses and
webhook subscriptions synced → backfill imports the order → shipping queue → pickup slot → ship (Idempotency-Key
replay returns the stored result, re-ship blocked) → label job → **airwaybill PDF downloaded** → signed webhook stored
and processed, duplicate ignored. The web app was exercised in Chromium (login, orders, shops, workbench).

Bugs found and fixed during integration:

- Fulfillment queue: `!=` excluded orders with no fulfillment type, so the queue was empty; cursor compared in the
  wrong direction; bucket counts were dropped when filtering by SLA; per-order join miscounted combined packages.
  Rewritten as one grouped query. Raw timestamps are now passed as ISO strings (postgres-js rejects `Date` there).
- Job download only looked for CSV exports, so label PDFs could not be downloaded.
- Ship replay returned `replayed: false`.
- Redis rate limiter ignored its URL, read the clock once (never refilled) and confused a 1 ms wait with success.
- Web app: `/login` reloaded forever (401 redirect on the session probe), a wrong password reloaded the page, and
  login returned to `/login` because the session was not re-read.
- Logistics routes awaited the Fastify reply (request hung); inactive shops returned 404 instead of 409.

Open follow-ups:

- **#9, #10** (human): register the app and verify signing, endpoint paths and webhook type numbers against the
  real docs and sandbox. Every TikTok path is still marked `VERIFY`.
- **#29**: the Shops page does not show the warehouse settings section yet (the API supports it).
- Tests run on PGlite; the queue bug above only showed on real Postgres. Consider running core tests against the
  CI Postgres service too.
