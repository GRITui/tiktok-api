import { createDepsFromEnv } from "@oms/core";
import { buildApp } from "./app.js";

const { deps, close } = createDepsFromEnv();
const app = await buildApp({ deps });
app.addHook("onClose", close);
await app.listen({ port: Number(process.env.API_PORT ?? 3000), host: "0.0.0.0" });
