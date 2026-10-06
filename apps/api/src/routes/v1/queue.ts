import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE E1 (#55)
 *  GET  /v1/fulfillment/queue?…FulfillmentQueueFilters → FulfillmentQueuePage (viewer)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function queueRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
