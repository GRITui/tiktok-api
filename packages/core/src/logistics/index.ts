/**
 * Logistics reference data & handover — LANE F1 (Sprint 4: #52 SDK verify, #36, #57, #35).
 * Contract: signatures below are used by other lanes; keep them stable.
 */
import { eq, and, not, inArray } from "drizzle-orm";
import { FulfillmentApi, slotAvailable } from "@oms/tiktok-sdk";
import { LogisticsApi } from "@oms/tiktok-sdk";
import { deliveryOptions, packageEvents, packages, shippingProviders, warehouses, orderPackages, orders } from "@oms/db";
import type { Deps } from "../context.js";
import { OmsError } from "../errors.js";
import { getShopContext } from "../auth/index.js";
import type { HandoverOptions, WarehouseView } from "../oms/types.js";

/** Sync warehouses, delivery options per warehouse, and shipping providers per delivery option. (#36) */
export async function syncLogistics(deps: Deps, shopId: string): Promise<{ warehouses: number }> {
  const ctx = await getShopContext(deps, shopId);
  const api = new LogisticsApi(deps.tts);

  // Fetch all warehouses
  const allWarehouses = await api.getWarehouses(ctx);

  const seenWarehouses = new Set<string>();
  const seenDeliveryOptions = new Set<string>();
  const seenShippingProviders = new Set<string>();

  // Upsert warehouses, delivery options, and shipping providers
  for (const wh of allWarehouses) {
    seenWarehouses.add(wh.id!);

    // Check if warehouse exists to preserve user settings
    const existing = await deps.db.query.warehouses.findFirst({
      where: and(eq(warehouses.shopId, shopId), eq(warehouses.id, wh.id!)),
    });

    // Upsert warehouse: preserve is_default and default_handover_method if they were set by user
    await deps.db.insert(warehouses).values({
      shopId,
      id: wh.id!,
      name: wh.name!,
      type: wh.type,
      isDefault: existing?.isDefault ?? wh.is_default ?? false,
      defaultHandoverMethod: existing?.defaultHandoverMethod ?? null,
      address: wh.address,
      raw: wh,
      syncedAt: deps.now(),
    }).onConflictDoUpdate({
      target: [warehouses.shopId, warehouses.id],
      set: {
        name: wh.name!,
        type: wh.type,
        address: wh.address,
        raw: wh,
        syncedAt: deps.now(),
        // Don't overwrite is_default or defaultHandoverMethod if they were set by user
      },
    });

    // Fetch delivery options for this warehouse
    const deliveryOptsList = await api.getWarehouseDeliveryOptions(ctx, wh.id!);

    for (const opt of deliveryOptsList) {
      seenDeliveryOptions.add(opt.id!);

      // Upsert delivery option
      await deps.db.insert(deliveryOptions).values({
        shopId,
        warehouseId: wh.id!,
        id: opt.id!,
        name: opt.name!,
        type: opt.type,
        raw: opt,
        syncedAt: deps.now(),
      }).onConflictDoUpdate({
        target: [deliveryOptions.shopId, deliveryOptions.warehouseId, deliveryOptions.id],
        set: {
          name: opt.name!,
          type: opt.type,
          raw: opt,
          syncedAt: deps.now(),
        },
      });

      // Fetch shipping providers for this delivery option
      const providers = await api.getShippingProviders(ctx, opt.id!);

      for (const prov of providers) {
        seenShippingProviders.add(prov.id!);

        // Upsert shipping provider
        await deps.db.insert(shippingProviders).values({
          shopId,
          deliveryOptionId: opt.id!,
          id: prov.id!,
          name: prov.name!,
          raw: prov,
          syncedAt: deps.now(),
        }).onConflictDoUpdate({
          target: [shippingProviders.shopId, shippingProviders.deliveryOptionId, shippingProviders.id],
          set: {
            name: prov.name!,
            raw: prov,
            syncedAt: deps.now(),
          },
        });
      }
    }
  }

  // Delete warehouses not seen in this sync
  await deps.db.delete(warehouses).where(
    and(
      eq(warehouses.shopId, shopId),
      not(inArray(warehouses.id, Array.from(seenWarehouses))),
    ),
  );

  // Delete delivery options not seen in this sync
  await deps.db.delete(deliveryOptions).where(
    and(
      eq(deliveryOptions.shopId, shopId),
      not(inArray(deliveryOptions.id, Array.from(seenDeliveryOptions))),
    ),
  );

  // Delete shipping providers not seen in this sync
  await deps.db.delete(shippingProviders).where(
    and(
      eq(shippingProviders.shopId, shopId),
      not(inArray(shippingProviders.id, Array.from(seenShippingProviders))),
    ),
  );

  return { warehouses: allWarehouses.length };
}

export async function listWarehouses(deps: Deps, shopId: string): Promise<WarehouseView[]> {
  const whList = await deps.db.query.warehouses.findMany({
    where: eq(warehouses.shopId, shopId),
  });

  const result: WarehouseView[] = [];

  for (const wh of whList) {
    const opts = await deps.db.query.deliveryOptions.findMany({
      where: and(eq(deliveryOptions.shopId, shopId), eq(deliveryOptions.warehouseId, wh.id)),
    });

    const optionsWithProviders = await Promise.all(
      opts.map(async (opt) => {
        const provs = await deps.db.query.shippingProviders.findMany({
          where: and(eq(shippingProviders.shopId, shopId), eq(shippingProviders.deliveryOptionId, opt.id)),
        });
        return {
          id: opt.id,
          name: opt.name,
          providers: provs.map((p: any) => ({ id: p.id, name: p.name })),
        };
      }),
    );

    result.push({
      shopId,
      id: wh.id,
      name: wh.name,
      isDefault: wh.isDefault,
      defaultHandoverMethod: (wh.defaultHandoverMethod as "PICKUP" | "DROP_OFF" | null) ?? null,
      deliveryOptions: optionsWithProviders,
    });
  }

  return result;
}

export async function updateWarehouseSettings(
  deps: Deps,
  shopId: string,
  warehouseId: string,
  input: { isDefault?: boolean; defaultHandoverMethod?: "PICKUP" | "DROP_OFF" | null },
): Promise<void> {
  // Check warehouse exists
  const wh = await deps.db.query.warehouses.findFirst({
    where: and(eq(warehouses.shopId, shopId), eq(warehouses.id, warehouseId)),
  });

  if (!wh) {
    throw new OmsError("not_found", "Warehouse not found", 404);
  }

  // Validate handover method
  if (input.defaultHandoverMethod !== undefined && input.defaultHandoverMethod !== null) {
    if (!["PICKUP", "DROP_OFF"].includes(input.defaultHandoverMethod)) {
      throw new OmsError("invalid_input", "Invalid handover method", 400);
    }
  }

  // If setting as default, clear default from other warehouses
  if (input.isDefault) {
    await deps.db.update(warehouses).set({ isDefault: false }).where(eq(warehouses.shopId, shopId));
  }

  // Update this warehouse
  await deps.db.update(warehouses).set({
    ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
    ...(input.defaultHandoverMethod !== undefined && { defaultHandoverMethod: input.defaultHandoverMethod }),
  }).where(and(eq(warehouses.shopId, shopId), eq(warehouses.id, warehouseId)));
}

/** Get Package Handover Time Slots. (#57) */
export async function getHandoverOptions(deps: Deps, packageId: string): Promise<HandoverOptions> {
  // Load package
  const pkg = await deps.db.query.packages.findFirst({
    where: eq(packages.id, packageId),
  });

  if (!pkg) {
    throw new OmsError("not_found", "Package not found", 404);
  }

  const ctx = await getShopContext(deps, pkg.shopId);
  const api = new FulfillmentApi(deps.tts);

  // Get handover time slots
  const slots = await api.getHandoverTimeSlots(ctx, packageId);

  return {
    canPickup: slots.can_pickup ?? false,
    canDropOff: slots.can_drop_off ?? false,
    pickupSlots: (slots.pickup_slots ?? []).map((s: any) => ({
      start: s.start_time,
      end: s.end_time,
      available: slotAvailable(s),
    })),
    dropOffPointUrl: slots.drop_off_point_url ?? null,
  };
}

/** Store chosen handover on the package; validates the slot against current options. (#57) */
export async function setPackageHandover(
  deps: Deps,
  packageId: string,
  input: { method: "PICKUP" | "DROP_OFF"; slot?: { start: number; end: number } },
): Promise<void> {
  // Load package
  const pkg = await deps.db.query.packages.findFirst({
    where: eq(packages.id, packageId),
  });

  if (!pkg) {
    throw new OmsError("not_found", "Package not found", 404);
  }

  const ctx = await getShopContext(deps, pkg.shopId);
  const api = new FulfillmentApi(deps.tts);

  // Get current handover options
  const opts = await api.getHandoverTimeSlots(ctx, packageId);

  // Validate method
  if (input.method === "PICKUP" && !opts.can_pickup) {
    throw new OmsError("invalid_input", "Pickup not available for this package", 400);
  }
  if (input.method === "DROP_OFF" && !opts.can_drop_off) {
    throw new OmsError("invalid_input", "Drop-off not available for this package", 400);
  }

  // Validate slot for PICKUP
  if (input.method === "PICKUP" && input.slot) {
    const availableSlots = (opts.pickup_slots ?? []).filter((s) => slotAvailable(s));
    const isValidSlot = availableSlots.some(
      (s) => s.start_time === input.slot!.start && s.end_time === input.slot!.end,
    );
    if (!isValidSlot) {
      throw new OmsError("invalid_slot", "Selected slot is not available", 400);
    }
  }

  // Update package
  await deps.db.update(packages).set({
    handoverMethod: input.method,
    pickupSlotStart: input.method === "PICKUP" && input.slot ? input.slot.start : null,
    pickupSlotEnd: input.method === "PICKUP" && input.slot ? input.slot.end : null,
    updatedAt: deps.now(),
  }).where(eq(packages.id, packageId));
}

/** PACKAGE_UPDATE webhook: fetch Get Package Detail, upsert package (ignore older update time), append package_events. (#35) */
export async function handlePackageUpdate(deps: Deps, input: { shopId: string; packageId: string }): Promise<void> {
  const ctx = await getShopContext(deps, input.shopId);
  const api = new FulfillmentApi(deps.tts);

  // Get package detail from API
  const detail = await api.getPackageDetail(ctx, input.packageId);

  // Check if we should ignore this update (older than what we have)
  const existing = await deps.db.query.packages.findFirst({
    where: eq(packages.id, input.packageId),
  });

  if (existing && existing.ttsUpdatedAt && detail.update_time && existing.ttsUpdatedAt > detail.update_time) {
    // Ignore older update
    return;
  }

  // Upsert package
  const now = deps.now();
  await deps.db.insert(packages).values({
    id: input.packageId,
    shopId: input.shopId,
    status: detail.package_status,
    shippingType: detail.shipping_type,
    deliveryOptionId: detail.delivery_option_id,
    warehouseId: detail.warehouse_id,
    handoverMethod: detail.handover_method,
    pickupSlotStart: detail.pickup_slot?.start_time,
    pickupSlotEnd: detail.pickup_slot?.end_time,
    trackingNumber: detail.tracking_number,
    shippingProviderId: detail.shipping_provider_id,
    shippingProvider: detail.shipping_provider_name,
    ttsUpdatedAt: detail.update_time,
    raw: detail,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [packages.id],
    set: {
      status: detail.package_status,
      shippingType: detail.shipping_type,
      deliveryOptionId: detail.delivery_option_id,
      warehouseId: detail.warehouse_id,
      handoverMethod: detail.handover_method,
      pickupSlotStart: detail.pickup_slot?.start_time,
      pickupSlotEnd: detail.pickup_slot?.end_time,
      trackingNumber: detail.tracking_number,
      shippingProviderId: detail.shipping_provider_id,
      shippingProvider: detail.shipping_provider_name,
      ttsUpdatedAt: detail.update_time,
      raw: detail,
      updatedAt: now,
    },
  });

  // If status changed, append event
  if (!existing || existing.status !== detail.package_status) {
    await deps.db.insert(packageEvents).values({
      packageId: input.packageId,
      status: detail.package_status!,
      ttsUpdatedAt: detail.update_time,
      createdAt: now,
    });
  }

  // Upsert order_packages for orders that exist locally
  if (detail.orders) {
    for (const order of detail.orders) {
      // Check if order exists
      const existingOrder = await deps.db.query.orders.findFirst({
        where: eq(orders.id, order.id),
      });

      if (existingOrder) {
        // Upsert order_package
        await deps.db.insert(orderPackages).values({
          orderId: order.id,
          packageId: input.packageId,
        }).onConflictDoNothing();
      }
    }
  }
}
