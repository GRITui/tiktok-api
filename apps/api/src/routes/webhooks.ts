import type { Deps } from "@oms/core";
import { verifyWebhookSignature, type WebhookEnvelope } from "@oms/tiktok-sdk";
import type { FastifyInstance } from "fastify";

/**
 * LANE D — webhook receiver (#19). Verify, persist (ingestWebhook), ACK fast.
 * Must stay unauthenticated (no requireRole); signature is the auth.
 */
export async function webhookRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/tiktok", async (req, reply) => {
    const rawBody = req.body as string;
    const ok = verifyWebhookSignature({
      appKey: opts.deps.config.appKey,
      appSecret: opts.deps.config.appSecret,
      rawBody,
      signature: req.headers.authorization,
    });
    if (!ok) return reply.code(401).send({ error: { code: "invalid_signature", message: "invalid signature" } });

    const event = JSON.parse(rawBody) as WebhookEnvelope;
    req.log.info({ type: event.type, shopId: event.shop_id, id: event.tts_notification_id }, "webhook received");
    // TODO(LANE D): await ingestWebhook(opts.deps, event)
    return reply.code(200).send({ ok: true });
  });
}
