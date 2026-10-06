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
