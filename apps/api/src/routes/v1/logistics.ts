import { Queues, OmsError, listWarehouses, updateWarehouseSettings, getHandoverOptions, setPackageHandover } from "@oms/core";
import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../../plugins/auth.js";

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
export async function logisticsRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  const { deps } = opts;

  // GET /shops/:shopId/warehouses (viewer)
  app.get<{ Params: { shopId: string } }>(
    "/shops/:shopId/warehouses",
    { preHandler: requireRole("viewer") },
    async (req) => {
      const shopId = req.params.shopId;
      return listWarehouses(deps, shopId);
    },
  );

  // POST /shops/:shopId/logistics/sync (ops) -> enqueue job
  app.post<{ Params: { shopId: string } }>(
    "/shops/:shopId/logistics/sync",
    { preHandler: requireRole("ops") },
    async (req, reply) => {
      const shopId = req.params.shopId;
      const epochMinute = Math.floor(deps.now().getTime() / 60000);
      const jobId = `logistics-${shopId}-manual-${epochMinute}`;
      await deps.queues.enqueue(Queues.logisticsSync, { shopId }, { jobId });
      await reply.code(202);
      return { ok: true };
    },
  );

  // PATCH /shops/:shopId/warehouses/:warehouseId (admin)
  app.patch<{ Params: { shopId: string; warehouseId: string }; Body: { isDefault?: boolean; defaultHandoverMethod?: string | null } }>(
    "/shops/:shopId/warehouses/:warehouseId",
    { preHandler: requireRole("admin") },
    async (req) => {
      const { shopId, warehouseId } = req.params;
      const input = req.body;

      // Validate defaultHandoverMethod
      if (input.defaultHandoverMethod !== undefined && input.defaultHandoverMethod !== null) {
        if (!["PICKUP", "DROP_OFF"].includes(input.defaultHandoverMethod)) {
          throw new OmsError("invalid_input", "defaultHandoverMethod must be 'PICKUP', 'DROP_OFF', or null", 400);
        }
      }

      await updateWarehouseSettings(deps, shopId, warehouseId, {
        isDefault: input.isDefault,
        defaultHandoverMethod: input.defaultHandoverMethod as "PICKUP" | "DROP_OFF" | null | undefined,
      });
    },
  );

  // GET /packages/:id/handover-options (ops)
  app.get<{ Params: { id: string } }>(
    "/packages/:id/handover-options",
    { preHandler: requireRole("ops") },
    async (req) => {
      const packageId = req.params.id;
      return getHandoverOptions(deps, packageId);
    },
  );

  // PUT /packages/:id/handover (ops) -> 204
  app.put<{ Params: { id: string }; Body: { method: string; slot?: { start: number; end: number } } }>(
    "/packages/:id/handover",
    { preHandler: requireRole("ops") },
    async (req, reply) => {
      const packageId = req.params.id;
      const input = req.body;

      if (!["PICKUP", "DROP_OFF"].includes(input.method)) {
        throw new OmsError("invalid_input", "method must be 'PICKUP' or 'DROP_OFF'", 400);
      }

      await setPackageHandover(deps, packageId, {
        method: input.method as "PICKUP" | "DROP_OFF",
        slot: input.slot,
      });

      await reply.code(204);
    },
  );
}
