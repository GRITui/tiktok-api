import cookie from "@fastify/cookie";
import type { Deps, SessionUser } from "@oms/core";
import Fastify from "fastify";
import { registerAuth } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { authRoutes } from "./routes/auth.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { omsAuthRoutes } from "./routes/v1/auth.js";
import { fulfillmentRoutes } from "./routes/v1/fulfillment.js";
import { jobRoutes } from "./routes/v1/jobs.js";
import { logisticsRoutes } from "./routes/v1/logistics.js";
import { orderRoutes } from "./routes/v1/orders.js";
import { queueRoutes } from "./routes/v1/queue.js";
import { shopRoutes } from "./routes/v1/shops.js";

export interface AppOptions {
  deps: Deps;
  /** Tests only: every request is authenticated as this user. */
  testUser?: SessionUser;
  logger?: boolean;
}

export async function buildApp({ deps, testUser, logger = true }: AppOptions) {
  const app = Fastify({ logger: logger ? { level: process.env.LOG_LEVEL ?? "info" } : false });
  await app.register(cookie);
  registerErrorHandler(app);
  registerAuth(app, { deps, testUser });

  app.get("/healthz", async () => ({ ok: true }));
  const opts = { deps };
  await app.register(authRoutes, opts); //            LANE C  /auth/tiktok/*
  await app.register(webhookRoutes, opts); //         LANE D  /webhooks/tiktok
  await app.register(shopRoutes, { ...opts, prefix: "/v1" }); //        LANE C
  await app.register(omsAuthRoutes, { ...opts, prefix: "/v1" }); //     LANE E1
  await app.register(orderRoutes, { ...opts, prefix: "/v1" }); //       LANE E1
  await app.register(jobRoutes, { ...opts, prefix: "/v1" }); //         LANE E1
  await app.register(queueRoutes, { ...opts, prefix: "/v1" }); //       LANE E1
  await app.register(logisticsRoutes, { ...opts, prefix: "/v1" }); //   LANE F1
  await app.register(fulfillmentRoutes, { ...opts, prefix: "/v1" }); // LANE F2
  return app;
}
