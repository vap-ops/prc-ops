// Spec 323 U3a — the Procurement Home hub's pure core (no UI, no DB).
//
// The hub (src/app/procurement/page.tsx) is procurement's portfolio landing: a
// per-project status strip + three STR sections of door tiles. Everything the
// page needs to decide — which projects to strip, their open/arrival counts, the
// STR door map, and how a door carries the active project filter — is pure and
// unit-tested here. The page is thin composition over this + the shared chrome.

import type { Database } from "@/lib/db/database.types";
import { LABOR_RATES_LABEL, SUBCONTRACTOR_LABEL } from "@/lib/i18n/labels";
import { ACTIVE_REQUEST_BANDS, requestBand } from "./request-bands";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// A lightweight PR projection — just the fields the strip counts (no ฿). RLS on
// the caller's client already scopes which rows resolve.
export interface HomeCountRow {
  projectId: string | null;
  status: PurchaseRequestStatus;
  eta: string | null;
}

export interface ProcurementProjectStatus {
  projectId: string;
  name: string;
  /** Open ขอซื้อ — requests in an active band (awaiting_approval / to_order / in_transit). */
  openCount: number;
  /** Arrivals-today — in_transit rows due-or-overdue (eta<=today) or with unknown eta. */
  arrivalsToday: number;
}

// A project appears on the strip only when it has OPEN procurement work — the
// active bands (spec 137, ACTIVE_REQUEST_BANDS SSOT). done/closed never surface it.
const OPEN_BANDS = new Set<string>(ACTIVE_REQUEST_BANDS);

// Per-project open + arrivals-today counts, from the caller's visible PR rows.
// Null-project (store-bound / project-level) rows are excluded from the per-
// project strip; unresolved-name projects (an own PR in a non-member project —
// RLS admits the row but the membership-scoped projects read resolves no name)
// are dropped, mirroring spec 311 U1. Name-sorted.
export function buildProcurementProjectStatus(
  rows: ReadonlyArray<HomeCountRow>,
  names: ReadonlyMap<string, string>,
  todayIso: string,
): ProcurementProjectStatus[] {
  const byId = new Map<string, { open: number; arrivals: number }>();
  for (const r of rows) {
    if (r.projectId === null) continue;
    const band = requestBand(r.status);
    if (!OPEN_BANDS.has(band)) continue;
    const acc = byId.get(r.projectId) ?? { open: 0, arrivals: 0 };
    acc.open += 1;
    // Arrivals-today mirrors filterIncomingLens("today"): in_transit + due-or-
    // overdue (eta<=today) OR unknown eta (the real receive pile).
    if (band === "in_transit" && (r.eta === null || r.eta <= todayIso)) acc.arrivals += 1;
    byId.set(r.projectId, acc);
  }
  return Array.from(byId, ([projectId, c]) => ({
    projectId,
    name: names.get(projectId) ?? "",
    openCount: c.open,
    arrivalsToday: c.arrivals,
  }))
    .filter((p) => p.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

// 🌐 shared = one copy across all projects (no lens); 🔀 spanning = default all,
// filterable to one (carries ?project=). Spec 323 §3.
export type DoorScope = "shared" | "spanning";

export interface ProcurementDoor {
  key: string;
  label: string;
  href: string;
  scope: DoorScope;
  /** Resources › labor-rates is procurement_manager + super only (money standard). */
  managerOnly?: boolean;
}

export interface ProcurementStrSection {
  key: "scope" | "time" | "resources";
  label: string;
  doors: ProcurementDoor[];
}

// The approved STR menu map (spec 323 §4). ของเข้า points at procurement's cross-
// project incoming band on /requests (there is no top-level /incoming route — the
// project-scoped /projects/[id]/incoming is the SA receive surface); when a
// project is active, procurementDoorHref carries the filter through.
export const PROCUREMENT_STR_SECTIONS: readonly ProcurementStrSection[] = [
  {
    key: "scope",
    label: "ขอบเขต",
    doors: [
      { key: "requests", label: "จัดซื้อ", href: "/requests", scope: "spanning" },
      { key: "catalog", label: "แคตตาล็อก", href: "/catalog", scope: "shared" },
      {
        key: "ordering-templates",
        label: "แผนสั่งซื้อ",
        href: "/settings/ordering-templates",
        scope: "shared",
      },
    ],
  },
  {
    key: "time",
    label: "เวลา",
    doors: [
      { key: "orders", label: "ใบสั่งซื้อ", href: "/requests/orders", scope: "spanning" },
      { key: "incoming", label: "ของเข้า", href: "/requests?band=in_transit", scope: "spanning" },
      { key: "reports", label: "รายงาน", href: "/requests/reports", scope: "spanning" },
    ],
  },
  {
    key: "resources",
    label: "ทรัพยากร",
    doors: [
      { key: "vendors", label: "ผู้ขาย", href: "/contacts/vendors", scope: "shared" },
      {
        key: "subcontractors",
        label: SUBCONTRACTOR_LABEL,
        href: "/contacts/subcontractors",
        scope: "shared",
      },
      { key: "equipment", label: "อุปกรณ์", href: "/equipment", scope: "shared" },
      { key: "rentals", label: "เช่าอุปกรณ์", href: "/equipment/rentals", scope: "spanning" },
      { key: "workers", label: "รายชื่อช่าง", href: "/workers", scope: "shared" },
      { key: "payroll", label: "ค่าแรง", href: "/payroll", scope: "spanning" },
      { key: "expenses", label: "ค่าใช้จ่าย", href: "/expenses", scope: "spanning" },
      {
        key: "labor-rates",
        label: LABOR_RATES_LABEL,
        href: "/settings/labor-rates",
        scope: "shared",
        managerOnly: true,
      },
    ],
  },
];

// A door's href with the active project woven in: 🌐 shared doors ignore it; 🔀
// spanning doors set ?project= (merging any existing query on the href). Mirrors
// projectLensHref's serialization for a door that may already carry a filter.
export function procurementDoorHref(door: ProcurementDoor, activeProjectId: string | null): string {
  if (door.scope === "shared" || !activeProjectId) return door.href;
  const [path, query = ""] = door.href.split("?");
  const params = new URLSearchParams(query);
  params.set("project", activeProjectId);
  return `${path}?${params.toString()}`;
}
