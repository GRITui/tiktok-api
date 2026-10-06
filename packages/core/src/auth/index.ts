/**
 * Seller authorization & shops — LANE C (Sprint 1: #14 #15 #16 #17 #18).
 * Contract: signatures below are used by other lanes; keep them stable.
 */
import type { Region } from "@oms/tiktok-sdk";
import type { Deps, ResolvedShop } from "../context.js";
import { notImplemented } from "../errors.js";
import type { ShopSummary } from "../oms/types.js";

export type { Region };

/** Create a single-use CSRF state (TTL 10 min) and return the seller authorize URL for the region. */
export async function createAuthorizeUrl(_deps: Deps, _region: Region): Promise<string> {
  return notImplemented("createAuthorizeUrl");
}

/**
 * Validate+consume `state`, exchange `code` for tokens, upsert the authorization (tokens encrypted),
 * sync authorized shops, then enqueue Queues.backfill and Queues.logisticsSync for each new/reactivated shop.
 * Rejects non-seller `user_type` with OmsError("unsupported_principal", 403).
 */
export async function handleAuthCallback(
  _deps: Deps,
  _params: { code: string; state: string },
): Promise<{ authorizationId: string; shopIds: string[] }> {
  return notImplemented("handleAuthCallback");
}

/** Upsert shops (with cipher) for an authorization; shops no longer returned are set active=false. */
export async function syncAuthorizedShops(_deps: Deps, _authorizationId: string): Promise<string[]> {
  return notImplemented("syncAuthorizedShops");
}

/**
 * Decrypted access token + cipher for a shop-scoped call. Refreshes the token first if it expires
 * within 5 minutes. Throws OmsError("shop_not_found", 404) or OmsError("shop_revoked", 409).
 */
export async function getShopContext(_deps: Deps, _shopId: string): Promise<ResolvedShop> {
  return notImplemented("getShopContext");
}

/** Refresh every non-revoked authorization whose access token expires within `withinHours` (default 24). */
export async function refreshExpiringTokens(
  _deps: Deps,
  _opts?: { withinHours?: number },
): Promise<{ refreshed: number; revoked: number }> {
  return notImplemented("refreshExpiringTokens");
}

/** Mark revoked; its shops stop syncing until the seller reconnects (reconnect clears revokedAt). */
export async function markAuthorizationRevoked(_deps: Deps, _authorizationId: string, _reason: string): Promise<void> {
  return notImplemented("markAuthorizationRevoked");
}

export async function listShops(_deps: Deps): Promise<ShopSummary[]> {
  return notImplemented("listShops");
}
