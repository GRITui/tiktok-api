import { getOrderDetail, listOrders, OmsError, startOrderExport, type Deps, type OrderListFilters } from "@oms/core";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../../plugins/auth.js";

/**
 * LANE E1 (#27 #30)
 *  GET  /v1/orders?…OrderListFilters → Page<OrderListItem> (viewer)
 *  GET  /v1/orders/:id → OrderDetail (viewer; 404)
 *  POST /v1/exports/orders  body OrderListFilters → 202 { jobId } (ops)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function orderRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  app.get<{ Querystring: Record<string, any> }>(
    "/orders",
    { preHandler: requireRole("viewer") },
    async (req) => {
      const filters: OrderListFilters = {
        shopId: req.query.shopId,
        status: req.query.status,
        from: req.query.from,
        to: req.query.to,
        sku: req.query.sku,
        q: req.query.q,
        sla: req.query.sla,
        cursor: req.query.cursor,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      };
      return listOrders(opts.deps, filters, req.user!);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/orders/:id",
    { preHandler: requireRole("viewer") },
    async (req, reply) => {
      const order = await getOrderDetail(opts.deps, req.params.id, req.user!);
      if (!order) throw new OmsError("not_found", "Order not found", 404);
      return order;
    },
  );

  app.post<{ Body: OrderListFilters }>(
    "/exports/orders",
    {
      preHandler: requireRole("ops"),
      schema: {
        body: {
          type: "object",
          properties: {
            shopId: { type: "string" },
            status: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            sku: { type: "string" },
            q: { type: "string" },
            sla: { type: "string" },
            cursor: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await startOrderExport(opts.deps, req.body, req.user!);
      reply.status(202);
      return result;
    },
  );
}
