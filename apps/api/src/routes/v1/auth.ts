import { login, logout, type Deps } from "@oms/core";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "../../plugins/auth.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * LANE E1 (#26)
 *  POST /v1/auth/login {email,password} → sets httpOnly cookie oms_session, returns SessionUser
 *  POST /v1/auth/logout → clears cookie
 *  GET  /v1/me → SessionUser (401 if not logged in)
 * Paths above include the /v1 prefix applied in app.ts — register them WITHOUT it (e.g. app.get("/orders")).
 * Use requireRole() from ../../plugins/auth.js; throw OmsError for 4xx.
 */
export async function omsAuthRoutes(app: FastifyInstance, opts: { deps: Deps }) {
  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string" }, password: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { token, user, expiresAt } = await login(opts.deps, req.body);
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        path: "/",
        secure: process.env.COOKIE_SECURE === "1",
        sameSite: "lax",
        expires: expiresAt,
      });
      return user;
    },
  );

  app.post("/auth/logout", { preHandler: requireRole("viewer") }, async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      await logout(opts.deps, token);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
    }
    return { ok: true };
  });

  app.get("/me", { preHandler: requireRole("viewer") }, async (req) => req.user);
}
