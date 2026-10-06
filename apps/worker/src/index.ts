import { Worker } from "bullmq";
import { Queues } from "./queues.js";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

// TODO(Sprint 2): wire real processors (webhook, order sync, token refresh) and repeatable schedules.
for (const name of Object.values(Queues)) {
  const worker = new Worker(name, async (job) => {
    console.log(`[${name}] received job ${job.id}`, job.data);
  }, { connection });
  worker.on("failed", (job, err) => console.error(`[${name}] job ${job?.id} failed`, err));
}

console.log("worker started:", Object.values(Queues).join(", "));
