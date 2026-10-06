import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE E1 (#30 #58 #33 UI support)
 *  GET  /v1/jobs/:id → JobView (viewer)
 *  GET  /v1/jobs/:id/download → streams jobs.result.filePath (pdf/csv) (ops)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function jobRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
