// Spec 323 U3a — the Procurement Home hub's pure core (no UI, no DB).
//
// Since spec 327: the dashboard (หน้าหลัก) is the selection surface and the
// section pages render project views with icon door chips on top. Everything
// they decide — the dashboard cards, the STR door map + icons, door hrefs and
// visibility — is pure and unit-tested here; the pages are thin composition.

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  ClipboardList,
  Coins,
  FileStack,
  FileText,
  Forklift,
  Hammer,
  HardHat,
  Package,
  PieChart,
  Receipt,
  ShoppingCart,
  Store,
  Truck,
  Wallet,
  Wrench,
} from "lucide-react";

import type { Database } from "@/lib/db/database.types";
import {
  CATALOG_LABEL,
  LABOR_RATES_LABEL,
  ORDERING_TEMPLATES_LABEL,
  PROJECT_COSTS_LABEL,
  SUBCONTRACTOR_LABEL,
  SUPPLY_PLAN_LABEL,
} from "@/lib/i18n/labels";
import { projectCostsHref, supplyPlanHref } from "@/lib/nav/project-paths";
import { anchorWorkPackageId, countLateRisk, type LateRiskRow } from "./late-risk";
import { ACTIVE_REQUEST_BANDS, requestBand, type RequestBand } from "./request-bands";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// A lightweight PR projection — just the fields the counts read (no ฿). RLS on
// the caller's client already scopes which rows resolve.
export interface HomeCountRow {
  projectId: string | null;
  status: PurchaseRequestStatus;
  eta: string | null;
}

// OPEN work = the active bands (spec 137, ACTIVE_REQUEST_BANDS SSOT);
// done/closed never count.
const OPEN_BANDS = new Set<string>(ACTIVE_REQUEST_BANDS);

// Arrivals-today mirrors filterIncomingLens("today"): in_transit + due-or-
// overdue (eta<=today) OR unknown eta (the real receive pile). Consumed by the
// U1 dashboard cards + alert strip.
export function isArrivalToday(band: RequestBand, eta: string | null, todayIso: string): boolean {
  return band === "in_transit" && (eta === null || eta <= todayIso);
}

// Spec 327 U1 — the dashboard card model. Cards come from the caller's FULL
// RLS projects read (procurement's projects policy admits every project), LEFT-
// joined over PR rows so a zero-open-PR project still renders a zero-count card
// (the #621 gap — the retired per-project strip derived from PR rows and
// vanished zero-PR projects; U6c removed it).
export interface DashboardPrRow extends HomeCountRow, LateRiskRow {}

export interface DashboardCard {
  projectId: string;
  name: string;
  /** Open ขอซื้อ + arrivals-today at PR.project_id grain — the same rule as the
   * strip, so the counts mirror what /requests?project= would show. */
  openCount: number;
  arrivalsToday: number;
  /** เสี่ยงช้า at ANCHOR-WP-project grain (ADR 0065): a late PR endangers the
   * project whose WP it feeds — including store-bound null-project PRs (§0.1). */
  lateRisk: number;
}

export function buildDashboardCards(
  projects: ReadonlyArray<{ id: string; name: string }>,
  prRows: ReadonlyArray<DashboardPrRow>,
  wpById: ReadonlyMap<string, { plannedStart: string | null; projectId: string }>,
  todayIso: string,
): DashboardCard[] {
  const open = new Map<string, number>();
  const arrivals = new Map<string, number>();
  const late = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);

  for (const r of prRows) {
    if (r.projectId !== null) {
      const band = requestBand(r.status);
      if (OPEN_BANDS.has(band)) {
        bump(open, r.projectId);
        if (isArrivalToday(band, r.eta, todayIso)) bump(arrivals, r.projectId);
      }
    }
  }
  // Late-risk attribution rides the anchor WP's project — countLateRisk per
  // anchor project keeps the SSOT predicate (late-risk.ts) as the only judge.
  for (const r of prRows) {
    const flagged = countLateRisk([r], wpById) === 1;
    if (!flagged) continue;
    const anchorId = anchorWorkPackageId(r);
    const anchorProject = anchorId ? wpById.get(anchorId)?.projectId : undefined;
    if (anchorProject) bump(late, anchorProject);
  }

  return projects
    .map((p) => ({
      projectId: p.id,
      name: p.name,
      openCount: open.get(p.id) ?? 0,
      arrivalsToday: arrivals.get(p.id) ?? 0,
      lateRisk: late.get(p.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  /** Spec 327 U6 — the door's glyph for the icon chip rows (icon SSOT: same
   * icon per destination app-wide, unique within a row; clash resolutions
   * pinned in procurement-home.test.ts). */
  icon: LucideIcon;
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
      {
        key: "requests",
        icon: ShoppingCart,
        label: "จัดซื้อ",
        href: "/requests",
        scope: "spanning",
      },
      // Spec 326's โครงการ door FOLDED by 327 U6c (D5): selection subsumes the
      // reachability it restored — every dashboard card carries a หน้าโครงการ
      // side-door and the S/T/R headers' project name opens the project page,
      // so the /projects HUB detour is no longer the path.
      { key: "catalog", icon: Package, label: CATALOG_LABEL, href: "/catalog", scope: "shared" },
      // The door read "แผนสั่งซื้อ" — a hardcoded literal that disagreed with its
      // OWN page (which titles itself ORDERING_TEMPLATES_LABEL) and read like a
      // PO plan rather than a template (operator 2026-07-18). Point it at the SSOT
      // so the Scope pair is self-explanatory: แผนจัดหา = the project's plan,
      // เทมเพลตแผนจัดหา = the template that seeds it.
      {
        key: "ordering-templates",
        icon: FileStack,
        label: ORDERING_TEMPLATES_LABEL,
        href: "/settings/ordering-templates",
        scope: "shared",
      },
      // Spec 323 follow-up — the per-project supply plan (แผนจัดหา). Its only prior
      // entry was an unlabeled icon chip on the project page; this gives it a named
      // hub door beside the template door that seeds it. 📍 project scope:
      // resolves to the active project's supply-plan page.
      {
        key: "supply-plan",
        icon: ClipboardList,
        label: SUPPLY_PLAN_LABEL,
        href: "/projects",
        scope: "project",
      },
    ],
  },
  {
    key: "time",
    label: "เวลา",
    doors: [
      {
        key: "orders",
        icon: FileText,
        label: "ใบสั่งซื้อ",
        href: "/requests/orders",
        scope: "spanning",
      },
      {
        key: "incoming",
        icon: Truck,
        label: "ของเข้า",
        href: "/requests?band=in_transit",
        scope: "spanning",
      },
      {
        key: "reports",
        icon: BarChart3,
        label: "รายงาน",
        href: "/requests/reports",
        scope: "spanning",
      },
    ],
  },
  {
    key: "resources",
    label: "ทรัพยากร",
    doors: [
      { key: "vendors", icon: Store, label: "ผู้ขาย", href: "/contacts/vendors", scope: "shared" },
      {
        key: "subcontractors",
        icon: Hammer,
        label: SUBCONTRACTOR_LABEL,
        href: "/contacts/subcontractors",
        scope: "shared",
      },
      { key: "equipment", icon: Wrench, label: "อุปกรณ์", href: "/equipment", scope: "shared" },
      {
        key: "rentals",
        icon: Forklift,
        label: "เช่าอุปกรณ์",
        href: "/equipment/rentals",
        scope: "spanning",
      },
      { key: "workers", icon: HardHat, label: "รายชื่อช่าง", href: "/workers", scope: "shared" },
      { key: "payroll", icon: Wallet, label: "ค่าแรง", href: "/payroll", scope: "spanning" },
      { key: "expenses", icon: Receipt, label: "ค่าใช้จ่าย", href: "/expenses", scope: "spanning" },
      // Spec 325 U3: the per-project cost view (money reads gated at the page —
      // PURCHASE_REPORT_ROLES admits both procurement tiers).
      {
        key: "costs",
        icon: PieChart,
        label: PROJECT_COSTS_LABEL,
        href: "/projects",
        scope: "project",
      },
      {
        key: "labor-rates",
        icon: Coins,
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
// visibleDoors). Mirrors projectLensHref's serialization.
export function procurementDoorHref(door: ProcurementDoor, activeProjectId: string | null): string {
  if (door.scope === "project") {
    // Each 📍 door resolves to its OWN per-project page — keyed by door.key so a
    // new project-scope door never silently inherits another's target. No active
    // project → the static href (the door is hidden then anyway, see
    // visibleDoors).
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
/** Spec 327 U6 — the dashboard's quick chip row: the most-used doors in a
 * deliberate order (queue → arriving → orders → catalog). Composed CROSS
 * section rows, so its icon uniqueness gets its own pin (a same-glyph addition
 * would render duplicate icons and pass the per-section pins). */
export const QUICK_DOORS: readonly ProcurementDoor[] = (
  ["requests", "incoming", "orders", "catalog"] as const
).map((key) => PROCUREMENT_STR_SECTIONS.flatMap((s) => s.doors).find((d) => d.key === key)!);

/** Doors-level form of the visibility rule (spec 327 U6 — the chip rows filter
 * arbitrary door lists, not whole sections). */
export function visibleDoors(
  doors: ReadonlyArray<ProcurementDoor>,
  isManager: boolean,
  activeProjectId: string | null,
): ProcurementDoor[] {
  return doors.filter(
    (d) => (!d.managerOnly || isManager) && (d.scope !== "project" || activeProjectId !== null),
  );
}
