import { OmsError } from "@oms/core";
import { TikTokApiError } from "@oms/tiktok-sdk";
import type { FastifyInstance } from "fastify";

/** Maps errors to the `ApiError` body shape: { error: { code, message, details? } }. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof OmsError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof TikTokApiError) {
      req.log.warn({ code: err.code, requestId: err.requestId, path: err.path }, "TikTok API error");
      return reply.code(502).send({
        error: { code: "tiktok_error", message: err.message, details: { ttsCode: err.code, requestId: err.requestId } },
      });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) return reply.code(400).send({ error: { code: "invalid_request", message: e.message } });
    req.log.error(err);
    return reply.code(e.statusCode ?? 500).send({ error: { code: "internal", message: "Internal error" } });
  });
}
