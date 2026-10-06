/**
 * Logistics reference data & handover — LANE F1 (Sprint 4: #52 SDK verify, #36, #57, #35).
 * Contract: signatures below are used by other lanes; keep them stable.
 */
import type { Deps } from "../context.js";
import { notImplemented } from "../errors.js";
import type { HandoverOptions, WarehouseView } from "../oms/types.js";

/** Sync warehouses, delivery options per warehouse, and shipping providers per delivery option. (#36) */
export async function syncLogistics(_deps: Deps, _shopId: string): Promise<{ warehouses: number }> {
  return notImplemented("syncLogistics");
}

export async function listWarehouses(_deps: Deps, _shopId: string): Promise<WarehouseView[]> {
  return notImplemented("listWarehouses");
}

export async function updateWarehouseSettings(
  _deps: Deps,
  _shopId: string,
  _warehouseId: string,
  _input: { isDefault?: boolean; defaultHandoverMethod?: "PICKUP" | "DROP_OFF" | null },
): Promise<void> {
  return notImplemented("updateWarehouseSettings");
}

/** Get Package Handover Time Slots. (#57) */
export async function getHandoverOptions(_deps: Deps, _packageId: string): Promise<HandoverOptions> {
  return notImplemented("getHandoverOptions");
}

/** Store chosen handover on the package; validates the slot against current options. (#57) */
export async function setPackageHandover(
  _deps: Deps,
  _packageId: string,
  _input: { method: "PICKUP" | "DROP_OFF"; slot?: { start: number; end: number } },
): Promise<void> {
  return notImplemented("setPackageHandover");
}

/** PACKAGE_UPDATE webhook: fetch Get Package Detail, upsert package (ignore older update time), append package_events. (#35) */
export async function handlePackageUpdate(_deps: Deps, _input: { shopId: string; packageId: string }): Promise<void> {
  return notImplemented("handlePackageUpdate");
}
