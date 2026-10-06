/**
 * Seller shipping (own carrier): ship with provider + tracking (#34), correct tracking after shipping (#61),
 * bulk tracking import from CSV (#60).
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@oms/db";
import { FulfillmentApi } from "@oms/tiktok-sdk";
import { getShopContext } from "../auth/index.js";
import type { Deps } from "../context.js";
import { OmsError } from "../errors.js";
import type { ShipResult } from "../oms/types.js";
import { refreshOrders } from "../orders/index.js";
import { Queues } from "../queues.js";
import { assertShippable, withIdempotency } from "./index.js";

export const SELLER_SHIPPING = "SELLER";

/** Carrier tracking numbers: letters, digits and dashes, 4–64 chars (whitespace is stripped). */
export function normalizeTrackingNumber(raw: string): string {
  const t = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9-]{4,64}$/.test(t)) {
    throw new OmsError("invalid_tracking_number", `Invalid tracking number "${raw}"`, 400);
  }
  return t;
}

async function loadPackage(deps: Deps, packageId: string) {
  const [pkg] = await deps.db.select().from(schema.packages).where(eq(schema.packages.id, packageId));
  if (!pkg) throw new OmsError("not_found", "Package not found", 404);
  return pkg;
}

function assertSellerShipping(pkg: { shippingType: string | null }) {
  if (pkg.shippingType !== SELLER_SHIPPING) {
    throw new OmsError(
      "wrong_shipping_type",
      "This package ships with TikTok Shipping; use the handover flow instead",
      409,
      { shippingType: pkg.shippingType },
    );
  }
}

/** Providers valid for the package: those of its delivery option, or all of the shop's if the option is unknown. */
export async function listPackageProviders(deps: Deps, packageId: string): Promise<{ id: string; name: string }[]> {
  const pkg = await loadPackage(deps, packageId);
  const where = pkg.deliveryOptionId
    ? and(eq(schema.shippingProviders.shopId, pkg.shopId), eq(schema.shippingProviders.deliveryOptionId, pkg.deliveryOptionId))
    : eq(schema.shippingProviders.shopId, pkg.shopId);
  const rows = await deps.db
    .selectDistinct({ id: schema.shippingProviders.id, name: schema.shippingProviders.name })
    .from(schema.shippingProviders)
    .where(where)
    .orderBy(schema.shippingProviders.name);
  return rows;
}

async function resolveProvider(deps: Deps, packageId: string, providerId: string) {
  const provider = (await listPackageProviders(deps, packageId)).find((p) => p.id === providerId);
  if (!provider) {
    throw new OmsError(
      "invalid_provider",
      "Shipping provider is not available for this package's delivery option (run Sync Logistics if it is new)",
      400,
      { shippingProviderId: providerId },
    );
  }
  return provider;
}

async function packageOrders(deps: Deps, packageId: string) {
  const links = await deps.db
    .select({ orderId: schema.orderPackages.orderId })
    .from(schema.orderPackages)
    .where(eq(schema.orderPackages.packageId, packageId));
  const ids = links.map((l) => l.orderId);
  const orders = ids.length
    ? await deps.db.select({ id: schema.orders.id, recipientHash: schema.orders.recipientHash }).from(schema.orders).where(inArray(schema.orders.id, ids))
    : [];
  return { ids, recipientHash: orders[0]?.recipientHash ?? null };
}

export interface SellerShipInput {
  packageId: string;
  actor: string;
  idempotencyKey: string;
  shippingProviderId: string;
  trackingNumber: string;
}

/** Mark a seller-shipping package as shipped with the carrier's tracking number (#34). */
export async function shipWithOwnCarrier(deps: Deps, input: SellerShipInput): Promise<ShipResult> {
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
  const pkg = await loadPackage(deps, input.packageId);
  const { result, replayed } = await withIdempotency(
    deps,
    { key: input.idempotencyKey, action: "ship_seller", targetId: input.packageId, actor: input.actor, shopId: pkg.shopId },
    async () => {
      assertSellerShipping(pkg);
      await assertShippable(deps, input.packageId);
      const provider = await resolveProvider(deps, input.packageId, input.shippingProviderId);

      const ctx = await getShopContext(deps, pkg.shopId);
      const api = new FulfillmentApi(deps.tts);
      await api.shipPackage(ctx, input.packageId, {
        self_shipment: { tracking_number: trackingNumber, shipping_provider_id: provider.id },
      });
      const detail = await api.getPackageDetail(ctx, input.packageId);

      const orders = await packageOrders(deps, input.packageId);
      await deps.db
        .update(schema.packages)
        .set({
          status: detail.package_status ?? pkg.status,
          trackingNumber: detail.tracking_number || trackingNumber,
          shippingProviderId: provider.id,
          shippingProvider: detail.shipping_provider_name || provider.name,
          handoverMethod: null,
          pickupSlotStart: null,
          pickupSlotEnd: null,
          shippedAt: deps.now(),
          shippedRecipientHash: orders.recipientHash,
          updatedAt: deps.now(),
        })
        .where(eq(schema.packages.id, input.packageId));
      await refreshOrders(deps, pkg.shopId, orders.ids);

      return {
        result: {
          packageId: input.packageId,
          status: detail.package_status ?? null,
          trackingNumber: detail.tracking_number || trackingNumber,
          replayed: false,
        } satisfies ShipResult,
      };
    },
  );
  return { ...result, replayed };
}

/** Fix the tracking number or carrier of an already-shipped seller-shipping package (#61). */
export async function updateSellerTracking(deps: Deps, input: SellerShipInput): Promise<ShipResult> {
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
  const pkg = await loadPackage(deps, input.packageId);
  const { result, replayed } = await withIdempotency(
    deps,
    { key: input.idempotencyKey, action: "update_tracking", targetId: input.packageId, actor: input.actor, shopId: pkg.shopId },
    async () => {
      assertSellerShipping(pkg);
      if (!pkg.shippedAt) throw new OmsError("not_shipped", "Package has not been shipped yet; ship it first", 409);
      const provider = await resolveProvider(deps, input.packageId, input.shippingProviderId);
      if (pkg.trackingNumber === trackingNumber && pkg.shippingProviderId === provider.id) {
        throw new OmsError("no_change", "Tracking number and carrier are unchanged", 400);
      }

      const ctx = await getShopContext(deps, pkg.shopId);
      // TikTok rejects this once the carrier has scanned the parcel; that error is returned to the user verbatim.
      await new FulfillmentApi(deps.tts).updatePackageShippingInfo(ctx, input.packageId, {
        tracking_number: trackingNumber,
        shipping_provider_id: provider.id,
      });
      await deps.db
        .update(schema.packages)
        .set({ trackingNumber, shippingProviderId: provider.id, shippingProvider: provider.name, updatedAt: deps.now() })
        .where(eq(schema.packages.id, input.packageId));

      return {
        result: {
          packageId: input.packageId,
          status: pkg.status,
          trackingNumber,
          replayed: false,
          // Kept in the audit log's response so the old value is recoverable.
          previous: { trackingNumber: pkg.trackingNumber, shippingProviderId: pkg.shippingProviderId },
        } as ShipResult & { previous: unknown },
      };
    },
  );
  const { previous: _previous, ...shipResult } = result as ShipResult & { previous?: unknown };
  return { ...shipResult, replayed };
}

// ─── CSV import (#60) ───────────────────────────────────────────────────────

export interface TrackingImportRow {
  line: number;
  /** As written in the file (package id or order id). */
  reference: string;
  provider: string;
  trackingNumber: string;
  packageId: string | null;
  shippingProviderId: string | null;
  status: "ok" | "error";
  error: string | null;
}

export const TRACKING_CSV_TEMPLATE = "order_or_package_id,shipping_provider,tracking_number\n";

/** Minimal RFC 4180 parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const MAX_IMPORT_ROWS = 2000;

/**
 * Validate a tracking CSV without calling TikTok. Columns: order or package id, shipping provider (id or name),
 * tracking number. A header row is detected and skipped. Each row resolves to a package that is unshipped,
 * seller-shipping, awaiting shipment, with a carrier valid for it.
 */
export async function previewTrackingImport(deps: Deps, csv: string): Promise<{ rows: TrackingImportRow[]; ok: number; errors: number }> {
  let records = parseCsv(csv);
  if (records[0] && /tracking/i.test(records[0].join(","))) records = records.slice(1);
  if (records.length === 0) throw new OmsError("empty_import", "The file has no rows", 400);
  if (records.length > MAX_IMPORT_ROWS) throw new OmsError("import_too_large", `At most ${MAX_IMPORT_ROWS} rows per file`, 400);

  const refs = records.map((r) => (r[0] ?? "").trim());
  const byPackage = await deps.db
    .select({ id: schema.packages.id })
    .from(schema.packages)
    .where(inArray(schema.packages.id, refs.length ? refs : ["-"]));
  const byOrder = await deps.db
    .select({ orderId: schema.orderPackages.orderId, packageId: schema.orderPackages.packageId })
    .from(schema.orderPackages)
    .where(inArray(schema.orderPackages.orderId, refs.length ? refs : ["-"]));
  const packageIds = new Set(byPackage.map((p) => p.id));
  const orderToPackages = new Map<string, string[]>();
  for (const l of byOrder) orderToPackages.set(l.orderId, [...(orderToPackages.get(l.orderId) ?? []), l.packageId]);

  const rows: TrackingImportRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const [ref = "", provider = "", tracking = ""] = records[i]!.map((f) => f.trim());
    const row: TrackingImportRow = {
      line: i + 1, reference: ref, provider, trackingNumber: tracking,
      packageId: null, shippingProviderId: null, status: "error", error: null,
    };
    rows.push(row);
    try {
      if (!ref || !provider || !tracking) throw new OmsError("missing_field", "Need id, shipping provider and tracking number");
      let packageId: string;
      if (packageIds.has(ref)) packageId = ref;
      else {
        const pkgs = orderToPackages.get(ref) ?? [];
        if (pkgs.length === 0) throw new OmsError("unknown_reference", "No order or package with this id");
        if (pkgs.length > 1) throw new OmsError("ambiguous_order", "Order has several packages; use the package id");
        packageId = pkgs[0]!;
      }
      if (seen.has(packageId)) throw new OmsError("duplicate_row", "Package appears more than once in the file");
      seen.add(packageId);
      row.packageId = packageId;
      row.trackingNumber = normalizeTrackingNumber(tracking);

      const pkg = await loadPackage(deps, packageId);
      assertSellerShipping(pkg);
      if (pkg.shippedAt) throw new OmsError("already_shipped", "Package is already shipped (use Edit tracking to change it)");
      const providers = await listPackageProviders(deps, packageId);
      const match = providers.find((p) => p.id === provider) ?? providers.find((p) => p.name.toLowerCase() === provider.toLowerCase());
      if (!match) throw new OmsError("invalid_provider", `Carrier "${provider}" is not available for this package`);
      row.shippingProviderId = match.id;
      row.status = "ok";
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
    }
  }
  const ok = rows.filter((r) => r.status === "ok").length;
  return { rows, ok, errors: rows.length - ok };
}

/** Validate, then create a "tracking_import" job for the valid rows and enqueue it. */
export async function startTrackingImport(
  deps: Deps,
  input: { csv: string; actor: string },
): Promise<{ jobId: string; accepted: number; rejected: TrackingImportRow[] }> {
  const preview = await previewTrackingImport(deps, input.csv);
  const valid = preview.rows.filter((r) => r.status === "ok");
  if (valid.length === 0) throw new OmsError("nothing_to_import", "No valid rows to import", 400, { rows: preview.rows });

  const [job] = await deps.db
    .insert(schema.jobs)
    .values({
      type: "tracking_import",
      status: "queued",
      total: valid.length,
      createdBy: input.actor,
      params: {
        actor: input.actor,
        rows: valid.map((r) => ({ packageId: r.packageId, shippingProviderId: r.shippingProviderId, trackingNumber: r.trackingNumber })),
      },
    })
    .returning({ id: schema.jobs.id });
  await deps.db.insert(schema.jobItems).values(valid.map((r) => ({ jobId: job!.id, targetId: r.packageId! })));
  await deps.queues.enqueue(Queues.trackingImport, { jobId: job!.id }, { jobId: `tracking-${job!.id}` });
  return { jobId: job!.id, accepted: valid.length, rejected: preview.rows.filter((r) => r.status === "error") };
}

/** Ship each pending item; per-item idempotency keys make reruns safe. */
export async function runTrackingImport(deps: Deps, jobId: string): Promise<void> {
  const [job] = await deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new OmsError("not_found", "Job not found", 404);
  const params = job.params as { actor: string; rows: { packageId: string; shippingProviderId: string; trackingNumber: string }[] };
  await deps.db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, jobId));

  const pending = new Set(
    (await deps.db.select().from(schema.jobItems).where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.status, "pending"))))
      .map((i) => i.targetId),
  );
  for (const row of params.rows) {
    if (!pending.has(row.packageId)) continue;
    let status = "succeeded";
    let error: string | null = null;
    let response: unknown = null;
    try {
      response = await shipWithOwnCarrier(deps, {
        packageId: row.packageId,
        actor: params.actor,
        idempotencyKey: `tracking-${jobId}-${row.packageId}`,
        shippingProviderId: row.shippingProviderId,
        trackingNumber: row.trackingNumber,
      });
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    }
    await deps.db
      .update(schema.jobItems)
      .set({ status, error, response: response as object | null, updatedAt: deps.now() })
      .where(and(eq(schema.jobItems.jobId, jobId), eq(schema.jobItems.targetId, row.packageId)));
  }

  const items = await deps.db.select({ status: schema.jobItems.status }).from(schema.jobItems).where(eq(schema.jobItems.jobId, jobId));
  const succeeded = items.filter((i) => i.status === "succeeded").length;
  const failed = items.filter((i) => i.status === "failed").length;
  await deps.db
    .update(schema.jobs)
    .set({
      status: failed === 0 ? "succeeded" : succeeded === 0 ? "failed" : "partial",
      succeeded,
      failed,
      finishedAt: deps.now(),
    })
    .where(eq(schema.jobs.id, jobId));
}
