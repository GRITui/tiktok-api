/**
 * Pinned API version per resource group. TikTok versions endpoints independently,
 * so confirm the newest supported version on each API reference page before bumping.
 * See docs/reference/tts-api-concepts-overview.md "API version".
 */
export const API_VERSIONS = {
  authorization: "202309",
  order: "202309",
  fulfillment: "202309",
  returnRefund: "202309",
  logistics: "202309",
  product: "202309",
  event: "202309",
  finance: "202309",
} as const;
