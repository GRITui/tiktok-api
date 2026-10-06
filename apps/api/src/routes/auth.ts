import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE C — seller onboarding (#14 #18).
 *  GET /auth/tiktok/connect?region=US|ROW  → 302 to createAuthorizeUrl(deps, region)   [requireRole("admin")]
 *  GET /auth/tiktok/callback?code&state    → handleAuthCallback, then 302 to `${WEB_ORIGIN ?? ""}/shops?connected=1`
 *                                            (on error 302 to /shops?error=<code>)
 */
export async function authRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
