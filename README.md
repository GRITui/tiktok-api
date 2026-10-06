# TikTok Shop OMS

Order Management System for TikTok Shop sellers, built on the [TikTok Shop Partner API (TTS API)](https://partner.tiktokshop.com/docv2/page/tts-api-concepts-overview).

It ingests orders from authorized shops (webhooks + incremental polling), stores them in Postgres, and exposes
fulfillment, cancellation and return workflows back to TikTok Shop.

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Sprint plan / backlog: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- TTS API notes: [`docs/reference/`](docs/reference/)

## Layout

```
apps/
  api/        Fastify HTTP service: seller OAuth, webhook receiver, OMS REST API
  worker/     BullMQ workers: webhook processing, order sync, token refresh
packages/
  tiktok-sdk/ Typed TTS API client: request signing, retries, auth, orders, fulfillment, returns
  db/         Drizzle ORM schema + migrations (Postgres)
```

## Getting started

**On a Mac:** `scripts/mac-dev.sh --create-admin you@example.com` does everything below plus a public tunnel for TikTok. See [`docs/RUN_ON_MAC.md`](docs/RUN_ON_MAC.md).

Manual steps:

```bash
cp .env.example .env            # fill TTS_APP_KEY / TTS_APP_SECRET / TTS_SERVICE_ID
docker compose up -d            # postgres + redis
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev:api                    # http://localhost:3000/healthz
pnpm dev:worker
```

Checks: `pnpm typecheck` · `pnpm test` · `pnpm build`

Workspace packages export their TypeScript sources under the `@oms/source` condition, so dev and tests
run without a build step.

## Status

Scaffold only. The SDK signs requests, retries, paginates order search and verifies webhooks. The API serves
`/healthz`, the seller authorize redirect and a signed webhook endpoint. Everything else is tracked as issues
per [`docs/ROADMAP.md`](docs/ROADMAP.md).

> **Verify before production:** the signing algorithm, webhook signature scheme, endpoint paths and webhook
> type numbers in `packages/tiktok-sdk` follow the 202309 API conventions but were written without access to
> the live reference pages. Sprint 0 includes validating each against the Partner Center API testing tool.
