import { createDepsFromEnv } from "@oms/core";
import { Queue, Worker } from "bullmq";
import { processors, schedules } from "./processors.js";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const { deps, close } = createDepsFromEnv();

const workers = Object.entries(processors).map(([name, fn]) => {
  const w = new Worker(name, (job) => fn(deps, job.data as Record<string, unknown>), {
    connection,
    concurrency: name === "tts-webhook" ? 10 : 2,
  });
  w.on("failed", (job, err) => console.error(`[${name}] job ${job?.id} failed: ${err.message}`));
  return w;
});

for (const s of schedules) {
  const q = new Queue(s.queue, { connection });
  await q.upsertJobScheduler(s.id, { every: s.everyMs }, { name: s.id, data: s.data });
  await q.close();
}

console.log(`worker started: ${Object.keys(processors).join(", ")}`);

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
