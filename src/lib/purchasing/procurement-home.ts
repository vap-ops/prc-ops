// Spec 323 U3a — the Procurement Home hub's pure core (no UI, no DB).
//
// The hub (src/app/procurement/page.tsx) is procurement's portfolio landing: a
// per-project status strip + three STR sections of door tiles. Everything the
// page needs to decide — which projects to strip, their open/arrival counts, the
// STR door map, and how a door carries the active project filter — is pure and
// unit-tested here. The page is thin composition over this + the shared chrome.

import type { Database } from "@/lib/db/database.types";
import {
  CATALOG_LABEL,
  LABOR_RATES_LABEL,
  PROJECT_COSTS_LABEL,
  SUBCONTRACTOR_LABEL,
  SUPPLY_PLAN_LABEL,
} from "@/lib/i18n/labels";
import { projectCostsHref, supplyPlanHref } from "@/lib/nav/project-paths";
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

// The status-strip row's tap target. The row shows a project's open ขอซื้อ +
// arrivals-today counts, so the tap goes WHERE THE COUNTS POINT — the จัดซื้อ
// list scoped to that project. It used to re-scope the hub's own ?project=
// filter, which is invisible for a single-project user (nav-coherence feedback
// 2026-07-17, zeeparn); scoping is the lens chips' job. Deliberately NO ?from=
// referrer: /requests is a TAB page (procurement's จัดซื้อ spine tab) — it
// renders no back chip by the tab grammar, so the param would be inert; the way
// back to the hub is the หน้าหลัก tab.
export function procurementStripHref(projectId: string): string {
  return `/requests?project=${projectId}`;
}

// 🌐 shared = one copy across all projects (no lens); 🔀 spanning = default all,
// filterable to one (carries ?project=). Spec 323 §3. 📍 project = the target
// EXISTS only per project (/projects/[id]/…): href resolves to the active
// project and the door renders only while the lens has one (spec 325 U3 — a
// door that sometimes dead-ends fails the §0 omotenashi test).
export type DoorScope = "shared" | "spanning" | "project";

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
      { key: "catalog", label: CATALOG_LABEL, href: "/catalog", scope: "shared" },
      {
        key: "ordering-templates",
        label: "แผนสั่งซื้อ",
        href: "/settings/ordering-templates",
        scope: "shared",
      },
      // Spec 323 follow-up — the per-project supply plan (แผนจัดหา). Its only prior
      // entry was an unlabeled icon chip on the project page; this gives it a named
      // hub door beside แผนสั่งซื้อ (the templates that seed it). 📍 project scope:
      // resolves to the active project's supply-plan page.
      { key: "supply-plan", label: SUPPLY_PLAN_LABEL, href: "/projects", scope: "project" },
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
      // Spec 325 U3: the per-project cost view (money reads gated at the page —
      // PURCHASE_REPORT_ROLES admits both procurement tiers).
      { key: "costs", label: PROJECT_COSTS_LABEL, href: "/projects", scope: "project" },
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

// Spec 323 U3b: the /procurement/[section] route param, validated against the
// STR section keys — anything else is null and the route 404s. Sections are
// distinct SUB-ROUTES (not ?section=) because the bottom-tab active rule is a
// query-blind longest-pathname-prefix (bottom-tab-bar.tsx), so only a pathname
// can light exactly one section tab.
export function parseProcurementSection(value: string): ProcurementStrSection["key"] | null {
  for (const section of PROCUREMENT_STR_SECTIONS) {
    if (section.key === value) return section.key;
  }
  return null;
}

// Per-door resolution for 📍 project-scope doors: door.key → its per-project
// page builder. Every project-scope door MUST appear here; an absent key falls
// through to the door's static href (a visible dead-end would fail §0, but the
// door is hidden without an active project anyway).
const PROJECT_DOOR_HREF: Record<string, (projectId: string) => string> = {
  costs: projectCostsHref,
  "supply-plan": supplyPlanHref,
};

// A door's href with the active project woven in: 🌐 shared doors ignore it; 🔀
// spanning doors set ?project= (merging any existing query on the href); 📍
// project doors resolve to the active project's own page (falling back to the
// static href when none is active — they are hidden then anyway, see
// visibleProcurementDoors). Mirrors projectLensHref's serialization.
export function procurementDoorHref(door: ProcurementDoor, activeProjectId: string | null): string {
  if (door.scope === "project") {
    // Each 📍 door resolves to its OWN per-project page — keyed by door.key so a
    // new project-scope door never silently inherits another's target. No active
    // project → the static href (the door is hidden then anyway, see
    // visibleProcurementDoors).
    const resolve = PROJECT_DOOR_HREF[door.key];
    return activeProjectId && resolve ? resolve(activeProjectId) : door.href;
  }
  if (door.scope === "shared" || !activeProjectId) return door.href;
  const [path, query = ""] = door.href.split("?");
  const params = new URLSearchParams(query);
  params.set("project", activeProjectId);
  return `${path}?${params.toString()}`;
}

// Spec 325 U3 — which of a section's doors render for this viewer + lens state:
// managerOnly doors need the manager tier; 📍 project doors need an active
// project (they'd dead-end otherwise — §0). Pure so the visibility rule is
// unit-tested; hub-body renders exactly this list.
export function visibleProcurementDoors(
  section: ProcurementStrSection,
  isManager: boolean,
  activeProjectId: string | null,
): ProcurementDoor[] {
  return section.doors.filter(
    (d) => (!d.managerOnly || isManager) && (d.scope !== "project" || activeProjectId !== null),
  );
}

// The project a 📍 door resolves to: the lens selection, or — when the caller
// has exactly ONE project — that sole project. The project lens shows no chips
// in a single-project world (project-lens.ts collapses at ≤1 named), so
// activeProjectId is never set there; without this fallback every project-scope
// door (ต้นทุนโครงการ, แผนจัดหา) would be invisible for the common one-project
// case. 2+ projects and no selection → null: the door stays hidden rather than
// pick one arbitrarily (dead-end guard, §0). Pure so hub-body stays thin.
export function effectiveDoorProjectId(
  activeProjectId: string | null,
  projects: ReadonlyArray<{ id: string }>,
): string | null {
  if (activeProjectId) return activeProjectId;
  const [sole] = projects;
  return projects.length === 1 && sole ? sole.id : null;
}
