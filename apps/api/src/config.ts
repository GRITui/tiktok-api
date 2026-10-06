import { z } from "zod";

const Env = z.object({
  TTS_APP_KEY: z.string().min(1),
  TTS_APP_SECRET: z.string().min(1),
  TTS_API_BASE_URL: z.string().url().default("https://open-api.tiktokglobalshop.com"),
  TTS_AUTH_BASE_URL: z.string().url().default("https://auth.tiktok-shops.com"),
  TTS_SERVICE_ID: z.string().default(""),
  DATABASE_URL: z.string().default("postgres://oms:oms@localhost:5432/oms"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  API_PORT: z.coerce.number().default(3000),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
