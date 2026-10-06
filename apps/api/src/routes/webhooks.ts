import type { FastifyInstance } from "fastify";
import { verifyWebhookSignature, type WebhookEnvelope } from "@oms/tiktok-sdk";
import type { Config } from "../config.js";

/**
 * Receives TikTok Shop webhook pushes. Must ACK fast: verify, persist, enqueue, return 200.
 * TODO(Sprint 2): insert into webhook_events (dedupe on tts_notification_id) and enqueue processing job.
 */
export async function webhookRoutes(app: FastifyInstance, opts: { config: Config }) {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/tiktok", async (req, reply) => {
    const rawBody = req.body as string;
    const ok = verifyWebhookSignature({
      appKey: opts.config.TTS_APP_KEY,
      appSecret: opts.config.TTS_APP_SECRET,
      rawBody,
      signature: req.headers.authorization,
    });
    if (!ok) return reply.code(401).send({ error: "invalid signature" });

    const event = JSON.parse(rawBody) as WebhookEnvelope;
    req.log.info({ type: event.type, shopId: event.shop_id, id: event.tts_notification_id }, "webhook received");
    return reply.code(200).send({ ok: true });
  });
}
