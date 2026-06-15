// Spec 112 — band-relative row health for the procurement grid. Color = the
// buyer's TIME pressure, not the requester's priority flag (which is stale once
// the item is ordered). Red MEANS a different thing per band: late-to-ORDER vs
// late-to-ARRIVE. Pure (no UI) so the rules are unit-tested.

import { procurementBand } from "./procurement-pipeline";
import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export type RowHealth = "late" | "at_risk" | "on_track" | "waiting";

// "Due soon" window for the not-yet-ordered band (days).
export const HEALTH_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

// Whole-day difference between two ISO date strings ("YYYY-MM-DD"), parsed as
// UTC midnight so the result is timezone-stable.
function daysUntil(iso: string, todayIso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(todayIso)) / DAY_MS);
}

export function rowHealth(
  status: PurchaseRequestStatus,
  eta: string | null,
  neededBy: string | null,
  todayIso: string,
): RowHealth {
  const band = procurementBand(status);

  // รอสั่งซื้อ — nothing ordered yet, so the deadline is needed_by.
  if (band === "to_order") {
    if (neededBy === null) return "on_track";
    const d = daysUntil(neededBy, todayIso);
    if (d < 0) return "late";
    if (d <= HEALTH_SOON_DAYS) return "at_risk";
    return "on_track";
  }

  // กำลังจัดส่ง — already ordered; the question is arrival, not urgency.
  if (band === "in_transit") {
    if (eta !== null && daysUntil(eta, todayIso) < 0) return "late";
    if (eta !== null && neededBy !== null && eta > neededBy) return "at_risk";
    return "on_track";
  }

  // ได้รับแล้ว — done.
  if (band === "received") return "on_track";

  // รออนุมัติ (and rejected/cancelled) — not the buyer's move.
  return "waiting";
}

export function rowHealthLabel(health: RowHealth): string {
  switch (health) {
    case "late":
      return "ต้องรีบดำเนินการ — เลยกำหนด";
    case "at_risk":
      return "ใกล้กำหนด";
    case "on_track":
      return "ตามแผน";
    case "waiting":
      return "รอดำเนินการ";
  }
}
