import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE E1 (#27 #30)
 *  GET  /v1/orders?…OrderListFilters → Page<OrderListItem> (viewer)
 *  GET  /v1/orders/:id → OrderDetail (viewer; 404)
 *  POST /v1/exports/orders  body OrderListFilters → 202 { jobId } (ops)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function orderRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
