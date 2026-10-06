import Fastify from "fastify";
import type { Config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { webhookRoutes } from "./routes/webhooks.js";

export async function buildApp(config: Config) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.get("/healthz", async () => ({ ok: true }));
  await app.register(authRoutes, { config });
  await app.register(webhookRoutes, { config });
  return app;
}
