import { basename, resolve, sep } from "node:path";
import { jobs } from "@oms/db";
import { eq } from "drizzle-orm";
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

      const [row] = await opts.deps.db.select({ result: jobs.result }).from(jobs).where(eq(jobs.id, req.params.id));
      const result = (row?.result ?? null) as { filePath?: string; contentType?: string } | null;
      if (!result?.filePath) throw new OmsError("not_found", "Download not available", 404);

      // Only serve files inside the configured storage dir.
      const root = resolve(opts.deps.config.fileStorageDir);
      const filePath = resolve(result.filePath);
      if (!filePath.startsWith(root + sep)) throw new OmsError("not_found", "File not found", 404);
      try {
        await stat(filePath);
      } catch {
        throw new OmsError("not_found", "File not found", 404);
      }

      const contentType = result.contentType ?? (filePath.endsWith(".pdf") ? "application/pdf" : "text/csv");
      reply.type(contentType);
      reply.header("content-disposition", `attachment; filename="${basename(filePath)}"`);
      return reply.send(createReadStream(filePath));
    },
  );
}
