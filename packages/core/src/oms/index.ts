/**
 * OMS users, order queries, export, jobs — LANE E1 (Sprint 3: #26 #27 #30, Sprint 4: #55).
 * Contract: signatures below are used by apps/api; keep them stable.
 */
import type { Deps } from "../context.js";
import { notImplemented } from "../errors.js";
import type {
  FulfillmentQueueFilters, FulfillmentQueuePage, JobView, OrderDetail, OrderListFilters, OrderListItem,
  Page, Role, SessionUser,
} from "./types.js";

export * from "./types.js";

const RANK: Record<Role, number> = { viewer: 0, ops: 1, admin: 2 };
export const hasRole = (user: Pick<SessionUser, "role">, required: Role) => RANK[user.role] >= RANK[required];

/** scrypt password hash; email lower-cased; throws OmsError("email_taken", 409). */
export async function createUser(
  _deps: Deps,
  _input: { email: string; password: string; role: Role; name?: string },
): Promise<SessionUser> {
  return notImplemented("createUser");
}

/** Throws OmsError("invalid_credentials", 401). Session TTL 12h; stores sha256(token) only. */
export async function login(
  _deps: Deps,
  _input: { email: string; password: string },
): Promise<{ token: string; user: SessionUser; expiresAt: Date }> {
  return notImplemented("login");
}

export async function getSessionUser(_deps: Deps, _token: string): Promise<SessionUser | null> {
  return notImplemented("getSessionUser");
}

export async function logout(_deps: Deps, _token: string): Promise<void> {
  return notImplemented("logout");
}

/** Keyset pagination on (tts_created_at desc, id desc). PII masked for viewers. */
export async function listOrders(_deps: Deps, _filters: OrderListFilters, _user: SessionUser): Promise<Page<OrderListItem>> {
  return notImplemented("listOrders");
}

export async function getOrderDetail(_deps: Deps, _orderId: string, _user: SessionUser): Promise<OrderDetail | null> {
  return notImplemented("getOrderDetail");
}

/** Packages of AWAITING_SHIPMENT orders (excluding FBT), sorted by rts_sla_at asc; with per-bucket counts. (#55) */
export async function getFulfillmentQueue(_deps: Deps, _filters: FulfillmentQueueFilters): Promise<FulfillmentQueuePage> {
  return notImplemented("getFulfillmentQueue");
}

/** Create a jobs row (type "order_export") and enqueue Queues.orderExport. */
export async function startOrderExport(_deps: Deps, _filters: OrderListFilters, _user: SessionUser): Promise<{ jobId: string }> {
  return notImplemented("startOrderExport");
}

/** Write CSV to config.fileStorageDir, set jobs.result = { filePath }. PII redacted per the creating user's role. */
export async function runOrderExport(_deps: Deps, _jobId: string): Promise<void> {
  return notImplemented("runOrderExport");
}

export async function getJob(_deps: Deps, _jobId: string): Promise<JobView | null> {
  return notImplemented("getJob");
}
