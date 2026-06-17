// Spec 137 — the site /requests worklist as action-state bands. The non-procurement
// view (site_admin / project_manager / super_admin) was a flat priority-then-date list;
// this groups rows by what's happening, most-actionable first, and a view filter hides
// received/closed by default. Pure → unit-tested. (Procurement keeps its spec-104
// pipeline; this is the site counterpart, aligned with the locked SA action-state lens.)

import type { Database } from "@/lib/db/database.types";
import { comparePendingRequests } from "@/lib/purchasing/pending-order";

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
  awaiting_approval: "รออนุมัติ",
  to_order: "อนุมัติแล้ว รอสั่งซื้อ",
  in_transit: "กำลังจัดส่ง",
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
  items: T[];
}

export function groupRequestsByBand<
  T extends {
    status: PurchaseRequestStatus;
    priority: PurchaseRequestPriority;
    requested_at: string;
  },
>(rows: ReadonlyArray<T>, view: RequestView): RequestBandGroup<T>[] {
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
    groups.push({ band, label: REQUEST_BAND_LABEL[band], items });
  }
  return groups;
}
