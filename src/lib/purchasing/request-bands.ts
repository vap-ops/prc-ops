// Spec 137 — the site /requests worklist as action-state bands. The non-procurement
// view (site_admin / project_manager / super_admin) was a flat priority-then-date list;
// this groups rows by what's happening, most-actionable first, and a view filter hides
// received/closed by default. Pure → unit-tested. (Procurement keeps its spec-104
// pipeline; this is the site counterpart, aligned with the locked SA action-state lens.)

import type { Database } from "@/lib/db/database.types";
import { comparePendingRequests } from "@/lib/purchasing/pending-order";
import { WORKLIST_BAND_TERM } from "@/lib/purchasing/worklist-band-vocab";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];
type PurchaseRequestPriority = Database["public"]["Enums"]["purchase_request_priority"];

export type RequestBand = "awaiting_approval" | "to_order" | "in_transit" | "done" | "closed";

// Display order — the site's action first, history last.
const REQUEST_BAND_ORDER: ReadonlyArray<RequestBand> = [
  "awaiting_approval",
  "to_order",
  "in_transit",
  "done",
  "closed",
];

export const REQUEST_BAND_LABEL: Record<RequestBand, string> = {
  // Shared with the procurement engine → cross-engine SSOT (worklist-band-vocab).
  awaiting_approval: WORKLIST_BAND_TERM.awaiting_approval,
  // The site adds "อนุมัติแล้ว" to the shared core — the requester wants to know
  // their request passed approval, not just that it's awaiting an order.
  to_order: `อนุมัติแล้ว ${WORKLIST_BAND_TERM.to_order}`,
  in_transit: WORKLIST_BAND_TERM.in_transit,
  // The site's own terminal framing — procurement calls the same state "ได้รับแล้ว".
  done: "เสร็จแล้ว",
  closed: "ไม่อนุมัติ / ยกเลิก",
};

export function requestBand(status: PurchaseRequestStatus): RequestBand {
  switch (status) {
    case "requested":
      return "awaiting_approval";
    case "approved":
      return "to_order";
    case "purchased":
    case "on_route":
      return "in_transit";
    case "delivered":
    case "site_purchased":
      return "done";
    case "rejected":
    case "cancelled":
      return "closed";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "closed";
    }
  }
}

export type RequestView = "active" | "done" | "all";

export const REQUEST_VIEWS: ReadonlyArray<RequestView> = ["active", "done", "all"];

export const REQUEST_VIEW_LABEL: Record<RequestView, string> = {
  active: "กำลังดำเนินการ",
  done: "เสร็จแล้ว",
  all: "ทั้งหมด",
};

export function parseRequestView(value: string | null | undefined): RequestView {
  return value === "done" || value === "all" ? value : "active";
}

// Which bands a view shows. active (default) HIDES received + closed — the operator's
// minimum ("filter out items received").
const VIEW_BANDS: Record<RequestView, ReadonlyArray<RequestBand>> = {
  active: ["awaiting_approval", "to_order", "in_transit"],
  done: ["done"],
  all: REQUEST_BAND_ORDER,
};

export interface RequestBandGroup<T> {
  band: RequestBand;
  label: string;
  /** The site's attention band — กำลังจัดส่ง (incoming → what they receive). Rendered
   *  amber to match the procurement pipeline's "act now" band. */
  hot: boolean;
  items: T[];
  /** Count of items whose ETA has passed (late arrivals to chase). 0 unless todayIso
   *  is supplied. Meaningful on the in_transit band. */
  overdue: number;
}

// The site's attention band is what's INCOMING (procurement's is what's to-buy).
const HOT_BAND: RequestBand = "in_transit";

export function groupRequestsByBand<
  T extends {
    status: PurchaseRequestStatus;
    priority: PurchaseRequestPriority;
    requested_at: string;
    eta?: string | null;
  },
>(rows: ReadonlyArray<T>, view: RequestView, todayIso?: string | null): RequestBandGroup<T>[] {
  const allowed = new Set(VIEW_BANDS[view]);
  const byBand = new Map<RequestBand, T[]>();
  for (const r of rows) {
    const band = requestBand(r.status);
    if (!allowed.has(band)) continue;
    const arr = byBand.get(band);
    if (arr) arr.push(r);
    else byBand.set(band, [r]);
  }

  const groups: RequestBandGroup<T>[] = [];
  for (const band of REQUEST_BAND_ORDER) {
    const items = byBand.get(band);
    if (!items || items.length === 0) continue;
    // Active bands rank by priority then oldest (the queue the team works by);
    // done/closed are history → newest-first.
    if (band === "done" || band === "closed") {
      items.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
    } else {
      items.sort(comparePendingRequests);
    }
    // Late arrivals (ETA before today, zero-padded ISO string compare) — the chase
    // signal site most wants. String compare is correct for YYYY-MM-DD.
    const overdue = todayIso ? items.filter((r) => r.eta != null && r.eta < todayIso).length : 0;
    groups.push({ band, label: REQUEST_BAND_LABEL[band], hot: band === HOT_BAND, items, overdue });
  }
  return groups;
}
