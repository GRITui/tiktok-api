import type { Deps } from "@oms/core";
import { listShops, OmsError, Queues } from "@oms/core";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireRole } from "../../plugins/auth.js";

/**
 * LANE C (#17 #29 backend)
 *  GET  /v1/shops → ShopSummary[] (viewer)
 *  POST /v1/shops/:id/resync → enqueue Queues.orderSync {shopId} (ops) → 202 { ok: true }
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function shopRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  // GET /v1/shops
  app.get("/shops", { preHandler: requireRole("viewer") }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const summary = await listShops(opts.deps);
    return reply.send(summary);
  });

  // POST /v1/shops/:id/resync
  app.post<{ Params: { id: string } }>(
    "/shops/:id/resync",
    { preHandler: requireRole("ops") },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const shopId = req.params.id;

      if (!shopId) {
        throw new OmsError("invalid_shop", "Shop ID is required", 400);
      }

      // Verify shop exists using a raw query since we can't import drizzle-orm types
      try {
        // Try to get all shops via listShops and verify it exists
        const allShops = await listShops(opts.deps);
        const shopExists = allShops.some((s) => s.id === shopId);

        if (!shopExists) {
          throw new OmsError("shop_not_found", "Shop not found", 404);
        }
      } catch (err) {
        if (err instanceof OmsError) throw err;
        throw new OmsError("shop_not_found", "Shop not found", 404);
      }

      // Enqueue order sync job
      await opts.deps.queues.enqueue(Queues.orderSync, { shopId }, { jobId: `order-sync-${shopId}` });

      return reply.code(202).send({ ok: true });
    },
  );
}
