import type { Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";

/**
 * LANE E1 (#26)
 *  POST /v1/auth/login {email,password} → sets httpOnly cookie oms_session, returns SessionUser
 *  POST /v1/auth/logout → clears cookie
 *  GET  /v1/me → SessionUser (401 if not logged in)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function omsAuthRoutes(_app: FastifyInstance, _opts: { deps: Deps }) {}
