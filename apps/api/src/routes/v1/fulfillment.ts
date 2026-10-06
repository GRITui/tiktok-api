import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE F2 (#32 #58 #33)
 *  POST /v1/packages/:id/ship {handoverMethod?, pickupSlot?} header Idempotency-Key (required) → ShipResult (ops)
 *  POST /v1/fulfillment/batch-ship {packageIds} → 202 { jobId } (ops)
 *  POST /v1/fulfillment/labels {packageIds, documentType} → 202 { jobId } (ops)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function fulfillmentRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
