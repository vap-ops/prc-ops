// Spec 300 U3 — the store's incoming-delivery view (คลัง & ของเข้า). The store page
// already shows on-hand + รับเข้า + ตรวจนับ, but nothing about what is ON THE WAY. This
// selects the project's incoming store-bound purchase requests (still `purchased`/
// `on_route`, WP-less — once they hit `delivered` the spec-195-P3 trigger auto-books them
// into the store, so they leave this list), filters them by the shared delivery lens
// (วันนี้/กำลังมา/ทั้งหมด, spec 300 U1), and orders them due-first so the SA sees what to
// chase. Pure — the page does the query + link-out to each PR's receive card.

import type { Database } from "@/lib/db/database.types";
import { filterIncomingLens, type IncomingLens } from "@/lib/purchasing/request-bands";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// The raw purchase_requests shape the store page reads (only the fields used here).
export interface RawStoreIncoming {
  id: string;
  item_description: string;
  quantity: number;
  unit: string;
  eta: string | null;
  status: PurchaseRequestStatus;
  supplier: string | null;
  /** Spec 305: the งวดส่ง (purchase_order_deliveries) this line rides on — the
   *  grouping key of the ของเข้า surface. Null = not yet scheduled. */
  delivery_id?: string | null;
  // A store-bound PR MAY have no catalog item (free-text) — fall back to item_description.
  catalog_items: { base_item: string; spec_attrs: string | null } | null;
}

export interface StoreIncomingRow {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  qty: number;
  unit: string;
  supplier: string | null;
  eta: string | null;
  status: PurchaseRequestStatus;
  /** ETA has passed (a late arrival to chase). */
  overdue: boolean;
  deliveryId: string | null;
}

// Due first (earliest ETA), unknown-ETA (null) last. String compare is correct for
// YYYY-MM-DD. Generic: rows and delivery groups sort by the same rule.
function byEtaDueFirst(a: { eta: string | null }, b: { eta: string | null }): number {
  if (a.eta == null && b.eta == null) return 0;
  if (a.eta == null) return 1;
  if (b.eta == null) return -1;
  return a.eta.localeCompare(b.eta);
}

export function selectStoreIncoming(
  rows: ReadonlyArray<RawStoreIncoming>,
  lens: IncomingLens,
  todayIso: string | null,
): StoreIncomingRow[] {
  return filterIncomingLens(rows, lens, todayIso)
    .map((r) => ({
      id: r.id,
      baseItem: r.catalog_items?.base_item ?? r.item_description,
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      qty: Number(r.quantity),
      unit: r.unit,
      supplier: r.supplier,
      eta: r.eta,
      status: r.status,
      overdue: todayIso != null && r.eta != null && r.eta < todayIso,
      deliveryId: r.delivery_id ?? null,
    }))
    .sort(byEtaDueFirst);
}

// ---------------------------------------------------------------------------
// Spec 305 — the ของเข้า surface shows one card per DELIVERY (งวดส่ง), because a
// delivery naturally carries many PR lines (operator directive 2026-07-12).
// Built on selectStoreIncoming: lens semantics stay item-level (filter first),
// grouping is presentation.

export interface IncomingDeliveryGroup {
  /** Stable render key — the delivery id, or the lone PR id for unscheduled lines. */
  key: string;
  deliveryId: string | null;
  supplier: string | null;
  /** Earliest member ETA (null = none known). */
  eta: string | null;
  /** Any member is late. */
  overdue: boolean;
  /** on_route once any member shipped, else purchased. */
  status: PurchaseRequestStatus;
  /** Due-first, as selectStoreIncoming ordered them. */
  items: StoreIncomingRow[];
}

export function selectIncomingDeliveries(
  rows: ReadonlyArray<RawStoreIncoming>,
  lens: IncomingLens,
  todayIso: string | null,
): IncomingDeliveryGroup[] {
  const items = selectStoreIncoming(rows, lens, todayIso);
  const groups = new Map<string, IncomingDeliveryGroup>();
  for (const item of items) {
    // A line without a delivery stays its own arrival — never lump strangers.
    const key = item.deliveryId ?? `pr:${item.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        deliveryId: item.deliveryId,
        supplier: item.supplier,
        eta: item.eta,
        overdue: item.overdue,
        status: item.status,
        items: [item],
      });
      continue;
    }
    existing.items.push(item);
    if (item.eta != null && (existing.eta == null || item.eta < existing.eta)) {
      existing.eta = item.eta;
    }
    existing.overdue = existing.overdue || item.overdue;
    if (item.status === "on_route") existing.status = "on_route";
    if (existing.supplier == null) existing.supplier = item.supplier;
  }
  // Same due-first order as the items; Map preserves first-seen order and the
  // sort is stable, so equal-ETA groups keep the item ordering.
  return [...groups.values()].sort(byEtaDueFirst);
}
