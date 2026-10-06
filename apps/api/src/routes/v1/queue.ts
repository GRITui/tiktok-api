import { getFulfillmentQueue, type Deps, type FulfillmentQueueFilters } from "@oms/core";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../../plugins/auth.js";

/**
 * LANE E1 (#55)
 *  GET  /v1/fulfillment/queue?…FulfillmentQueueFilters → FulfillmentQueuePage (viewer)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function queueRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  app.get<{ Querystring: Record<string, any> }>(
    "/fulfillment/queue",
    { preHandler: requireRole("viewer") },
    async (req) => {
      const filters: FulfillmentQueueFilters = {
        shopId: req.query.shopId,
        warehouseId: req.query.warehouseId,
        shippingType: req.query.shippingType,
        deliveryOptionId: req.query.deliveryOptionId,
        sla: req.query.sla,
        sku: req.query.sku,
        cursor: req.query.cursor,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      };
      return getFulfillmentQueue(opts.deps, filters);
    },
  );
}
