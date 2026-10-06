import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE C (#17 #29 backend)
 *  GET  /v1/shops → ShopSummary[] (viewer)
 *  POST /v1/shops/:id/resync → enqueue Queues.orderSync {shopId} (ops) → 202 { ok: true }
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function shopRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
