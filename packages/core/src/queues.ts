/** Queue names shared by API (producer) and worker (consumer). */
export const Queues = {
  /** Process a stored webhook_events row. data: { eventId: number } */
  webhook: "tts-webhook",
  /** Incremental order poll. data: { shopId: string } */
  orderSync: "tts-order-sync",
  /** Historical backfill. data: { shopId: string } */
  backfill: "tts-backfill",
  /** Refresh access tokens expiring soon. data: {} */
  tokenRefresh: "tts-token-refresh",
  /** Sync warehouses / delivery options / providers. data: { shopId: string } */
  logisticsSync: "tts-logistics-sync",
  /** User-visible jobs (batch ship, labels, export). data: { jobId: string } */
  batchShip: "oms-batch-ship",
  labels: "oms-labels",
  orderExport: "oms-order-export",
  /** Fans out per-shop orderSync/logisticsSync jobs on a schedule. data: { kind: "orders" | "logistics" } */
  scheduler: "oms-scheduler",
} as const;

export type QueueName = (typeof Queues)[keyof typeof Queues];

export interface EnqueueOptions {
  /** Deduplicates: a job with the same id already queued is not added again. */
  jobId?: string;
  delayMs?: number;
}

/** Thin producer interface so core logic does not depend on BullMQ directly. */
export interface QueueProducer {
  enqueue(queue: QueueName, data: Record<string, unknown>, opts?: EnqueueOptions): Promise<void>;
}

/** In-memory producer for tests: records everything enqueued. */
export class RecordingQueue implements QueueProducer {
  readonly jobs: { queue: QueueName; data: Record<string, unknown>; opts?: EnqueueOptions }[] = [];
  async enqueue(queue: QueueName, data: Record<string, unknown>, opts?: EnqueueOptions) {
    this.jobs.push({ queue, data, opts });
  }
}
