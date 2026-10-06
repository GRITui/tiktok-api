import type { Deps } from "@oms/core";
import { shipPackage, startBatchShip, startLabelJob, OmsError } from "@oms/core";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../../plugins/auth.js";
import { z } from "zod";

/**
 * LANE F2 (#32 #58 #33)
 *  POST /v1/packages/:id/ship {handoverMethod?, pickupSlot?} header Idempotency-Key (required) → ShipResult (ops)
 *  POST /v1/fulfillment/batch-ship {packageIds} → 202 { jobId } (ops)
 *  POST /v1/fulfillment/labels {packageIds, documentType} → 202 { jobId } (ops)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function fulfillmentRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  const { deps } = opts;

  // POST /packages/:id/ship
  app.post<{ Params: { id: string }; Body: { handoverMethod?: "PICKUP" | "DROP_OFF"; pickupSlot?: { start: number; end: number } } }>(
    "/packages/:id/ship",
    { preHandler: requireRole("ops") },
    async (req, reply) => {
      // Check for Idempotency-Key header
      const idempotencyKey = req.headers["idempotency-key"];
      if (!idempotencyKey) {
        throw new OmsError("idempotency_key_required", "Idempotency-Key header is required", 400);
      }

      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw new OmsError("idempotency_key_invalid", "Idempotency-Key must be 8–128 chars", 400);
      }

      const packageId = req.params.id;
      const { handoverMethod, pickupSlot } = req.body || {};

      const result = await shipPackage(deps, {
        packageId,
        actor: req.user!.email,
        idempotencyKey,
        handoverMethod,
        pickupSlot,
      });

      return reply.send(result);
    },
  );

  // POST /fulfillment/batch-ship
  app.post<{ Body: { packageIds: string[] } }>(
    "/fulfillment/batch-ship",
    { preHandler: requireRole("ops") },
    async (req, reply) => {
      const { packageIds } = req.body || {};

      if (!Array.isArray(packageIds) || packageIds.length < 1 || packageIds.length > 500) {
        throw new OmsError("invalid_input", "packageIds must be an array of 1..500 strings", 400);
      }

      const result = await startBatchShip(deps, {
        packageIds,
        actor: req.user!.email,
      });

      return reply.status(202).send(result);
    },
  );

  // POST /fulfillment/labels
  app.post<{ Body: { packageIds: string[]; documentType: string } }>(
    "/fulfillment/labels",
    { preHandler: requireRole("ops") },
    async (req, reply) => {
      const { packageIds, documentType } = req.body || {};

      if (!Array.isArray(packageIds) || packageIds.length < 1 || packageIds.length > 500) {
        throw new OmsError("invalid_input", "packageIds must be an array of 1..500 strings", 400);
      }

      if (!["SHIPPING_LABEL", "PACKING_SLIP", "SHIPPING_LABEL_AND_PACKING_SLIP"].includes(documentType)) {
        throw new OmsError("invalid_input", "documentType must be SHIPPING_LABEL, PACKING_SLIP, or SHIPPING_LABEL_AND_PACKING_SLIP", 400);
      }

      const result = await startLabelJob(deps, {
        packageIds,
        documentType: documentType as "SHIPPING_LABEL" | "PACKING_SLIP" | "SHIPPING_LABEL_AND_PACKING_SLIP",
        actor: req.user!.email,
      });

      return reply.status(202).send(result);
    },
  );
}
