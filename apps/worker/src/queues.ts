/** Queue names shared by API (producer) and worker (consumer). */
export const Queues = {
  /** Process a stored webhook_events row. */
  webhook: "tts-webhook",
  /** Incremental order poll per shop (backstop for missed webhooks). */
  orderSync: "tts-order-sync",
  /** Refresh access tokens before expiry. */
  tokenRefresh: "tts-token-refresh",
} as const;
