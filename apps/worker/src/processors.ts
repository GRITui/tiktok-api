import {
  type Deps, Queues, type QueueName,
  processWebhookEvent, runOrderSync, runBackfill, refreshExpiringTokens, syncLogistics,
  runBatchShip, runLabelJob, runOrderExport,
} from "@oms/core";
import { shops } from "@oms/db";
import { eq } from "drizzle-orm";

type Processor = (deps: Deps, data: Record<string, unknown>) => Promise<unknown>;

const str = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v) throw new Error(`job data.${name} missing`);
  return v;
};

/** Fan-out: enqueue a per-shop job for every active shop, deduped by jobId per time bucket. */
async function schedule(deps: Deps, data: Record<string, unknown>) {
  const kind = data.kind === "logistics" ? "logistics" : "orders";
  const queue = kind === "logistics" ? Queues.logisticsSync : Queues.orderSync;
  const bucket = Math.floor(deps.now().getTime() / 60_000);
  const rows = await deps.db.select({ id: shops.id }).from(shops).where(eq(shops.active, true));
  for (const { id } of rows) await deps.queues.enqueue(queue, { shopId: id }, { jobId: `${kind}-${id}-${bucket}` });
  return { shops: rows.length };
}

/** Queue → handler. Handlers live in @oms/core; this file only adapts job data. */
export const processors: Record<QueueName, Processor> = {
  [Queues.webhook]: (d, j) => processWebhookEvent(d, Number(j.eventId)),
  [Queues.orderSync]: (d, j) => runOrderSync(d, str(j.shopId, "shopId")),
  [Queues.backfill]: (d, j) => runBackfill(d, str(j.shopId, "shopId")),
  [Queues.tokenRefresh]: (d) => refreshExpiringTokens(d),
  [Queues.logisticsSync]: (d, j) => syncLogistics(d, str(j.shopId, "shopId")),
  [Queues.batchShip]: (d, j) => runBatchShip(d, str(j.jobId, "jobId")),
  [Queues.labels]: (d, j) => runLabelJob(d, str(j.jobId, "jobId")),
  [Queues.orderExport]: (d, j) => runOrderExport(d, str(j.jobId, "jobId")),
  [Queues.scheduler]: schedule,
};

/** Repeatable schedules (BullMQ job schedulers). */
export const schedules: { queue: QueueName; id: string; everyMs: number; data: Record<string, unknown> }[] = [
  { queue: Queues.tokenRefresh, id: "token-refresh", everyMs: 60 * 60_000, data: {} },
  { queue: Queues.scheduler, id: "orders-poll", everyMs: 5 * 60_000, data: { kind: "orders" } },
  { queue: Queues.scheduler, id: "logistics-daily", everyMs: 24 * 60 * 60_000, data: { kind: "logistics" } },
];
