import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE F1 (#36 #57)
 *  GET  /v1/shops/:shopId/warehouses → WarehouseView[] (viewer)
 *  POST /v1/shops/:shopId/logistics/sync → enqueue Queues.logisticsSync → 202 (ops)
 *  PATCH /v1/shops/:shopId/warehouses/:warehouseId {isDefault?, defaultHandoverMethod?} (admin)
 *  GET  /v1/packages/:id/handover-options → HandoverOptions (ops)
 *  PUT  /v1/packages/:id/handover {method, slot?} → 204 (ops)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function logisticsRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
