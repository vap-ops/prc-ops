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
}

// Due first (earliest ETA), unknown-ETA (null) last. String compare is correct for
// YYYY-MM-DD.
function byEtaDueFirst(a: StoreIncomingRow, b: StoreIncomingRow): number {
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
    }))
    .sort(byEtaDueFirst);
}
