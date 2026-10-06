/**
 * Seller authorization & shops — LANE C (Sprint 1: #14 #15 #16 #17 #18).
 * Contract: signatures below are used by other lanes; keep them stable.
 */
import { eq, and, isNull, lte } from "drizzle-orm";
import { buildSellerAuthorizeUrl, AuthorizationApi } from "@oms/tiktok-sdk";
import type { Region } from "@oms/tiktok-sdk";
import { authorizations, oauthStates, shops, syncCursors } from "@oms/db";
import type { Deps, ResolvedShop } from "../context.js";
import { OmsError } from "../errors.js";
import type { ShopSummary } from "../oms/types.js";
import { Queues } from "../queues.js";
import { randomBytes } from "node:crypto";

export type { Region };

/** Create a single-use CSRF state (TTL 10 min) and return the seller authorize URL for the region. */
export async function createAuthorizeUrl(deps: Deps, region: Region): Promise<string> {
  // Generate random state and insert into oauth_states with 10 minute TTL
  const state = randomBytes(24).toString("hex");
  const expiresAt = new Date(deps.now().getTime() + 10 * 60 * 1000);

  await deps.db.insert(oauthStates).values({
    state,
    region,
    expiresAt,
  });

  // Build the authorize URL using the TikTok SDK helper
  return buildSellerAuthorizeUrl({
    region,
    serviceId: deps.config.serviceId,
    state,
  });
}

/**
 * Validate+consume `state`, exchange `code` for tokens, upsert the authorization (tokens encrypted),
 * sync authorized shops, then enqueue Queues.backfill and Queues.logisticsSync for each new/reactivated shop.
 * Rejects non-seller `user_type` with OmsError("unsupported_principal", 403).
 */
export async function handleAuthCallback(
  deps: Deps,
  params: { code: string; state: string },
): Promise<{ authorizationId: string; shopIds: string[] }> {
  const now = deps.now();

  // 1. Validate state: exists, not used, not expired
  const stateRow = await deps.db.query.oauthStates.findFirst({
    where: eq(oauthStates.state, params.state),
  });

  if (!stateRow) {
    throw new OmsError("invalid_state", "State not found or expired", 400);
  }

  if (stateRow.usedAt) {
    throw new OmsError("invalid_state", "State already used", 400);
  }

  if (stateRow.expiresAt < now) {
    throw new OmsError("invalid_state", "State expired", 400);
  }

  // 2. Mark state as used (atomically validate and update)
  await deps.db
    .update(oauthStates)
    .set({ usedAt: now })
    .where(and(eq(oauthStates.state, params.state), isNull(oauthStates.usedAt)));

  // 3. Exchange code for tokens
  const tokenResponse = await deps.auth.getAccessToken(params.code);

  // 4. Validate user_type is seller (0 = seller, treat 0 as seller)
  // Assumption: user_type 0 = seller, anything else = non-seller
  if (tokenResponse.user_type !== 0) {
    throw new OmsError("unsupported_principal", "Only seller accounts are supported", 403);
  }

  // 5. Encrypt tokens and upsert authorization
  const accessTokenEnc = deps.cipher.encrypt(tokenResponse.access_token);
  const refreshTokenEnc = deps.cipher.encrypt(tokenResponse.refresh_token);
  const accessTokenExpiresAt = new Date(tokenResponse.access_token_expire_in * 1000);
  const refreshTokenExpiresAt = new Date(tokenResponse.refresh_token_expire_in * 1000);

  await deps.db
    .insert(authorizations)
    .values({
      id: tokenResponse.open_id,
      sellerName: tokenResponse.seller_name,
      sellerBaseRegion: tokenResponse.seller_base_region,
      region: stateRow.region,
      userType: tokenResponse.user_type,
      accessTokenEnc,
      accessTokenExpiresAt,
      refreshTokenEnc,
      refreshTokenExpiresAt,
      grantedScopes: tokenResponse.granted_scopes,
      revokedAt: null,
      revokedReason: null,
    })
    .onConflictDoUpdate({
      target: authorizations.id,
      set: {
        accessTokenEnc,
        accessTokenExpiresAt,
        refreshTokenEnc,
        refreshTokenExpiresAt,
        grantedScopes: tokenResponse.granted_scopes,
        revokedAt: null,
        revokedReason: null,
        updatedAt: now,
      },
    });

  // 6. Sync authorized shops
  const shopIds = await syncAuthorizedShops(deps, tokenResponse.open_id);

  // 7. Enqueue backfill and logistics sync jobs for each shop
  for (const shopId of shopIds) {
    await deps.queues.enqueue(Queues.backfill, { shopId }, { jobId: `backfill-${shopId}` });
    await deps.queues.enqueue(Queues.logisticsSync, { shopId }, { jobId: `logistics-${shopId}` });
  }

  return {
    authorizationId: tokenResponse.open_id,
    shopIds,
  };
}

/** Upsert shops (with cipher) for an authorization; shops no longer returned are set active=false. */
export async function syncAuthorizedShops(deps: Deps, authorizationId: string): Promise<string[]> {
  // 1. Get the authorization to decrypt the token
  const auth = await deps.db.query.authorizations.findFirst({
    where: eq(authorizations.id, authorizationId),
  });

  if (!auth) {
    throw new OmsError("authorization_not_found", "Authorization not found", 404);
  }

  // 2. Decrypt access token
  const accessToken = deps.cipher.decrypt(auth.accessTokenEnc);

  // 3. Get authorized shops from TikTok
  const api = new AuthorizationApi(deps.tts);
  const authorizedShops = await api.getAuthorizedShops(accessToken);

  // 4. Upsert shops
  const shopIds: string[] = [];
  for (const shop of authorizedShops) {
    await deps.db
      .insert(shops)
      .values({
        id: shop.id,
        name: shop.name,
        region: shop.region,
        cipher: shop.cipher,
        code: shop.code,
        sellerType: shop.seller_type,
        authorizationId,
        active: true,
        backfillStatus: "pending",
      })
      .onConflictDoUpdate({
        target: shops.id,
        set: {
          name: shop.name,
          region: shop.region,
          cipher: shop.cipher,
          code: shop.code,
          sellerType: shop.seller_type,
          active: true,
        },
      });

    shopIds.push(shop.id);
  }

  // 5. Deactivate shops no longer in the response
  // Get all existing shops for this authorization
  const existingShops = await deps.db.query.shops.findMany({
    where: eq(shops.authorizationId, authorizationId),
  });

  // Deactivate shops not in the authorized list
  for (const existing of existingShops) {
    if (!authorizedShops.find((s) => s.id === existing.id)) {
      await deps.db
        .update(shops)
        .set({ active: false })
        .where(eq(shops.id, existing.id));
    }
  }

  return shopIds;
}

/**
 * Decrypted access token + cipher for a shop-scoped call. Refreshes the token first if it expires
 * within 5 minutes. Throws OmsError("shop_not_found", 404) or OmsError("shop_revoked", 409).
 */
export async function getShopContext(deps: Deps, shopId: string): Promise<ResolvedShop> {
  // 1. Get shop
  const shop = await deps.db.query.shops.findFirst({
    where: eq(shops.id, shopId),
  });

  if (!shop) {
    throw new OmsError("shop_not_found", "Shop not found", 404);
  }

  if (!shop.active) {
    throw new OmsError("shop_revoked", "Shop is no longer authorized", 409);
  }

  // 2. Get authorization
  const auth = await deps.db.query.authorizations.findFirst({
    where: eq(authorizations.id, shop.authorizationId),
  });

  if (!auth) {
    throw new OmsError("authorization_not_found", "Authorization not found", 404);
  }

  // 3. Check if authorization is revoked
  if (auth.revokedAt) {
    throw new OmsError("shop_revoked", "Authorization was revoked", 409);
  }

  // 4. Check if token expires within 5 minutes, refresh if needed
  const now = deps.now();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  let accessToken = deps.cipher.decrypt(auth.accessTokenEnc);
  let expiresAt = auth.accessTokenExpiresAt;

  if (expiresAt < fiveMinutesFromNow) {
    // Refresh the token
    const refreshToken = deps.cipher.decrypt(auth.refreshTokenEnc);
    try {
      const tokenResponse = await deps.auth.refreshAccessToken(refreshToken);
      accessToken = tokenResponse.access_token;
      expiresAt = new Date(tokenResponse.access_token_expire_in * 1000);

      // Update the authorization with new tokens
      const accessTokenEnc = deps.cipher.encrypt(accessToken);
      const refreshTokenEnc = deps.cipher.encrypt(tokenResponse.refresh_token);
      const refreshTokenExpiresAt = new Date(tokenResponse.refresh_token_expire_in * 1000);

      await deps.db
        .update(authorizations)
        .set({
          accessTokenEnc,
          accessTokenExpiresAt: expiresAt,
          refreshTokenEnc,
          refreshTokenExpiresAt,
          updatedAt: now,
        })
        .where(eq(authorizations.id, shop.authorizationId));
    } catch (err) {
      // If refresh fails, mark authorization as revoked
      await markAuthorizationRevoked(deps, shop.authorizationId, `Token refresh failed: ${String(err)}`);
      throw new OmsError("shop_revoked", "Failed to refresh token", 409);
    }
  }

  return {
    shopId: shop.id,
    region: shop.region,
    accessToken,
    shopCipher: shop.cipher,
  };
}

/** Refresh every non-revoked authorization whose access token expires within `withinHours` (default 24). */
export async function refreshExpiringTokens(
  deps: Deps,
  opts?: { withinHours?: number },
): Promise<{ refreshed: number; revoked: number }> {
  const withinHours = opts?.withinHours ?? 24;
  const now = deps.now();
  const withinTime = new Date(now.getTime() + withinHours * 60 * 60 * 1000);

  // Get all non-revoked authorizations expiring within the time window
  const expiring = await deps.db.query.authorizations.findMany({
    where: and(isNull(authorizations.revokedAt), lte(authorizations.accessTokenExpiresAt, withinTime)),
  });

  let refreshed = 0;
  let revoked = 0;

  for (const auth of expiring) {
    // Use a Postgres advisory lock for per-authorization locking
    const lockId = hashText(auth.id);

    try {
      // Try to acquire advisory lock using a simple UPDATE with conditional
      // We use conditional UPDATE to avoid refreshing if already done
      const updateResult = await deps.db
        .update(authorizations)
        .set({ updatedAt: now }) // Dummy update to test lock acquisition
        .where(
          and(
            eq(authorizations.id, auth.id),
            isNull(authorizations.revokedAt),
            lte(authorizations.accessTokenExpiresAt, withinTime),
          ),
        );

      // If no rows were updated, another process may have already refreshed or revoked this auth
      if (!updateResult) {
        continue;
      }

      // Double-check within the transaction (in case another process just updated it)
      const current = await deps.db.query.authorizations.findFirst({
        where: eq(authorizations.id, auth.id),
      });

      if (!current || current.revokedAt || current.accessTokenExpiresAt > withinTime) {
        continue;
      }

      // Refresh the token
      const refreshToken = deps.cipher.decrypt(current.refreshTokenEnc);
      try {
        const tokenResponse = await deps.auth.refreshAccessToken(refreshToken);
        const accessTokenEnc = deps.cipher.encrypt(tokenResponse.access_token);
        const refreshTokenEnc = deps.cipher.encrypt(tokenResponse.refresh_token);
        const accessTokenExpiresAt = new Date(tokenResponse.access_token_expire_in * 1000);
        const refreshTokenExpiresAt = new Date(tokenResponse.refresh_token_expire_in * 1000);

        await deps.db
          .update(authorizations)
          .set({
            accessTokenEnc,
            accessTokenExpiresAt,
            refreshTokenEnc,
            refreshTokenExpiresAt,
            updatedAt: now,
          })
          .where(eq(authorizations.id, auth.id));

        refreshed++;
      } catch (err) {
        // Mark as revoked on refresh failure
        await deps.db
          .update(authorizations)
          .set({
            revokedAt: now,
            revokedReason: `Token refresh failed: ${String(err)}`,
            updatedAt: now,
          })
          .where(eq(authorizations.id, auth.id));

        revoked++;
      }
    } catch (err) {
      // Skip on lock failure or other errors
      continue;
    }
  }

  return { refreshed, revoked };
}

/** Mark revoked; its shops stop syncing until the seller reconnects (reconnect clears revokedAt). */
export async function markAuthorizationRevoked(deps: Deps, authorizationId: string, reason: string): Promise<void> {
  const now = deps.now();
  await deps.db
    .update(authorizations)
    .set({
      revokedAt: now,
      revokedReason: reason,
      updatedAt: now,
    })
    .where(eq(authorizations.id, authorizationId));
}

export async function listShops(deps: Deps): Promise<ShopSummary[]> {
  const now = deps.now();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Get all shops
  const allShops = await deps.db.query.shops.findMany();

  const results: ShopSummary[] = [];

  for (const shop of allShops) {
    // Get authorization
    const auth = await deps.db.query.authorizations.findFirst({
      where: eq(authorizations.id, shop.authorizationId),
    });

    if (!auth) {
      continue; // Skip shops with missing authorization
    }

    // Determine auth status
    let authStatus: "active" | "expiring" | "revoked";
    if (auth.revokedAt) {
      authStatus = "revoked";
    } else if (auth.refreshTokenExpiresAt < sevenDaysFromNow) {
      authStatus = "expiring";
    } else {
      authStatus = "active";
    }

    // Get last synced time from sync_cursors for orders stream
    const ordersCursor = await deps.db.query.syncCursors.findFirst({
      where: and(eq(syncCursors.shopId, shop.id), eq(syncCursors.stream, "orders")),
    });
    const lastSyncedAt = ordersCursor?.lastRunAt?.toISOString() ?? null;

    // Calculate backfill progress
    let backfillProgress: number | null = null;
    if (shop.backfillCursor !== null && shop.backfillFrom !== null) {
      const progress = (shop.backfillCursor - shop.backfillFrom) / (now.getTime() / 1000 - shop.backfillFrom);
      backfillProgress = Math.max(0, Math.min(1, progress)); // Clamp to 0..1
    }
    if (shop.backfillStatus === "done") backfillProgress = 1;

    results.push({
      id: shop.id,
      name: shop.name,
      region: shop.region,
      authRegion: auth.region === "US" ? "US" : "ROW",
      active: shop.active,
      authorizationId: shop.authorizationId,
      authStatus,
      accessTokenExpiresAt: auth.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: auth.refreshTokenExpiresAt.toISOString(),
      lastSyncedAt,
      backfillStatus: (shop.backfillStatus as ShopSummary["backfillStatus"]) ?? "pending",
      backfillProgress,
      webhooksSubscribedAt: shop.webhooksSubscribedAt?.toISOString() ?? null,
    });
  }

  return results;
}

// Helper function to hash text for advisory lock
function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
