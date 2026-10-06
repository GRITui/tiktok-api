import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildSellerAuthorizeUrl, type Region } from "@oms/tiktok-sdk";
import type { Config } from "../config.js";

/**
 * Seller onboarding.
 * TODO(Sprint 1): persist `state` (CSRF), exchange code via AuthApi.getAccessToken,
 * fetch authorized shops, store encrypted tokens + shop ciphers.
 */
export async function authRoutes(app: FastifyInstance, opts: { config: Config }) {
  app.get<{ Querystring: { region?: Region } }>("/auth/tiktok/connect", async (req, reply) => {
    const state = randomBytes(16).toString("hex");
    const url = buildSellerAuthorizeUrl({ region: req.query.region ?? "ROW", serviceId: opts.config.TTS_SERVICE_ID, state });
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/tiktok/callback", async (req, reply) => {
    if (!req.query.code) return reply.code(400).send({ error: "missing code" });
    return reply.code(501).send({ error: "not implemented", todo: "Sprint 1: token exchange" });
  });
}
