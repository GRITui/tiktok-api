import { getSessionUser, hasRole, OmsError, type Deps, type Role, type SessionUser } from "@oms/core";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";

export const SESSION_COOKIE = "oms_session";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/**
 * Resolves `request.user` from the session cookie on every request.
 * `testUser` bypasses session lookup (tests only).
 */
export function registerAuth(app: FastifyInstance, opts: { deps: Deps; testUser?: SessionUser }) {
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    if (opts.testUser) {
      req.user = opts.testUser;
      return;
    }
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = token ? await getSessionUser(opts.deps, token) : null;
  });
}

/** preHandler: 401 when not logged in, 403 when below `role`. */
export const requireRole = (role: Role): preHandlerHookHandler => async (req) => {
  if (!req.user) throw new OmsError("unauthenticated", "Login required", 401);
  if (!hasRole(req.user, role)) throw new OmsError("forbidden", `Requires role ${role}`, 403);
};
