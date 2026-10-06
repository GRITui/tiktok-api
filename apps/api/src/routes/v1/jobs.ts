import { getJob, OmsError, type Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { requireRole } from "../../plugins/auth.js";

/**
 * LANE E1 (#30 #58 #33 UI support)
 *  GET  /v1/jobs/:id → JobView (viewer)
 *  GET  /v1/jobs/:id/download → streams jobs.result.filePath (pdf/csv) (ops)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function jobRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  app.get<{ Params: { id: string } }>(
    "/jobs/:id",
    { preHandler: requireRole("viewer") },
    async (req) => {
      const job = await getJob(opts.deps, req.params.id);
      if (!job) throw new OmsError("not_found", "Job not found", 404);
      return job;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/jobs/:id/download",
    { preHandler: requireRole("ops") },
    async (req, reply) => {
      const job = await getJob(opts.deps, req.params.id);
      if (!job) throw new OmsError("not_found", "Job not found", 404);

      if (!job.downloadUrl) throw new OmsError("not_found", "Download not available", 404);

      // Parse the job ID and construct the file path based on job type
      const filePath = `${opts.deps.config.fileStorageDir}/exports/${req.params.id}.csv`;

      // Check if file exists
      try {
        await stat(filePath);
      } catch (e) {
        throw new OmsError("not_found", "File not found", 404);
      }

      // Determine content type based on job type
      const contentType = "text/csv";
      reply.type(contentType);
      reply.send(createReadStream(filePath));
    },
  );
}
