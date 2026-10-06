import type { Deps } from "@oms/core";
import { createAuthorizeUrl, handleAuthCallback, OmsError } from "@oms/core";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireRole } from "../plugins/auth.js";

/**
 * LANE C — seller onboarding (#14 #18).
 *  GET /auth/tiktok/connect?region=US|ROW  → 302 to createAuthorizeUrl(deps, region)   [requireRole("admin")]
 *  GET /auth/tiktok/callback?code&state    → handleAuthCallback, then 302 to `${WEB_ORIGIN ?? ""}/shops?connected=1`
 *                                            (on error 302 to /shops?error=<code>)
 */
export async function authRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  const webOrigin = process.env.WEB_ORIGIN ?? "";

  // GET /auth/tiktok/connect?region=US|ROW
  app.get<{ Querystring: { region?: string } }>(
    "/auth/tiktok/connect",
    { preHandler: requireRole("admin") },
    async (req: FastifyRequest<{ Querystring: { region?: string } }>, reply: FastifyReply) => {
      const region = req.query.region;

      // Validate region parameter
      if (!region || !["US", "ROW"].includes(region)) {
        return reply.code(400).send({
          error: { code: "invalid_region", message: "region must be 'US' or 'ROW'" },
        });
      }

      try {
        const authorizeUrl = await createAuthorizeUrl(opts.deps, region as "US" | "ROW");
        return reply.status(302).redirect(authorizeUrl);
      } catch (err) {
        req.log.error(err, "Failed to create authorize URL");
        return reply.code(500).send({
          error: { code: "internal_error", message: "Failed to create authorization URL" },
        });
      }
    },
  );

  // GET /auth/tiktok/callback?code&state
  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/tiktok/callback",
    async (req: FastifyRequest<{ Querystring: { code?: string; state?: string } }>, reply: FastifyReply) => {
      const code = req.query.code;
      const state = req.query.state;

      if (!code || !state) {
        return reply.status(302).redirect(`${webOrigin}/shops?error=missing_params`);
      }

      try {
        await handleAuthCallback(opts.deps, { code, state });
        return reply.status(302).redirect(`${webOrigin}/shops?connected=1`);
      } catch (err) {
        if (err instanceof OmsError) {
          req.log.warn({ error: err.code }, "Authorization callback failed");
          return reply.status(302).redirect(`${webOrigin}/shops?error=${err.code}`);
        }
        req.log.error(err, "Unexpected error in auth callback");
        return reply.status(302).redirect(`${webOrigin}/shops?error=internal_error`);
      }
    },
  );
}
