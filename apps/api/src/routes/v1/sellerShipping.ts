import {
  listPackageProviders, OmsError, previewTrackingImport, shipWithOwnCarrier, startTrackingImport,
  TRACKING_CSV_TEMPLATE, updateSellerTracking, type Deps,
} from "@oms/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireRole } from "../../plugins/auth.js";

/**
 * Seller shipping (#34 #60 #61), all ops+:
 *  GET  /v1/packages/:id/shipping-providers → { id, name }[]
 *  POST /v1/packages/:id/ship-seller {shippingProviderId, trackingNumber}  header Idempotency-Key → ShipResult
 *  PUT  /v1/packages/:id/tracking    {shippingProviderId, trackingNumber}  header Idempotency-Key → ShipResult
 *  GET  /v1/fulfillment/tracking-import/template → CSV template
 *  POST /v1/fulfillment/tracking-import/preview {csv} → { rows, ok, errors }   (validates only)
 *  POST /v1/fulfillment/tracking-import {csv} → 202 { jobId, accepted, rejected }
 */
export async function sellerShippingRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  const { deps } = opts;
  const ops = { preHandler: requireRole("ops") };

  const trackingBody = {
    type: "object",
    required: ["shippingProviderId", "trackingNumber"],
    properties: {
      shippingProviderId: { type: "string", minLength: 1, maxLength: 64 },
      trackingNumber: { type: "string", minLength: 1, maxLength: 80 },
    },
  } as const;
  const csvBody = {
    type: "object",
    required: ["csv"],
    properties: { csv: { type: "string", minLength: 1, maxLength: 500_000 } },
  } as const;

  app.get<{ Params: { id: string } }>("/packages/:id/shipping-providers", ops, async (req) =>
    listPackageProviders(deps, req.params.id),
  );

  app.post<{ Params: { id: string }; Body: { shippingProviderId: string; trackingNumber: string } }>(
    "/packages/:id/ship-seller",
    { ...ops, schema: { body: trackingBody } },
    async (req) =>
      shipWithOwnCarrier(deps, {
        packageId: req.params.id,
        actor: req.user!.email,
        idempotencyKey: idempotencyKey(req),
        ...req.body,
      }),
  );

  app.put<{ Params: { id: string }; Body: { shippingProviderId: string; trackingNumber: string } }>(
    "/packages/:id/tracking",
    { ...ops, schema: { body: trackingBody } },
    async (req) =>
      updateSellerTracking(deps, {
        packageId: req.params.id,
        actor: req.user!.email,
        idempotencyKey: idempotencyKey(req),
        ...req.body,
      }),
  );

  app.get("/fulfillment/tracking-import/template", ops, async (_req, reply) =>
    reply
      .type("text/csv")
      .header("content-disposition", 'attachment; filename="tracking-import-template.csv"')
      .send(TRACKING_CSV_TEMPLATE),
  );

  app.post<{ Body: { csv: string } }>("/fulfillment/tracking-import/preview", { ...ops, schema: { body: csvBody } }, async (req) =>
    previewTrackingImport(deps, req.body.csv),
  );

  app.post<{ Body: { csv: string } }>(
    "/fulfillment/tracking-import",
    { ...ops, schema: { body: csvBody } },
    async (req, reply) => reply.code(202).send(await startTrackingImport(deps, { csv: req.body.csv, actor: req.user!.email })),
  );
}

function idempotencyKey(req: FastifyRequest): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8 || key.length > 128) {
    throw new OmsError("idempotency_key_required", "Idempotency-Key header (8–128 chars) is required", 400);
  }
  return key;
}
