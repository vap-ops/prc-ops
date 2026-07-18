// Writing failing test first.
//
// Spec 323 U3a — the Procurement Home hub's pure core. The hub (src/app/
// procurement/page.tsx) is a portfolio landing: a per-project status strip
// (open ขอซื้อ count + arrivals-today count, derived from the caller's visible
// purchase_requests) and three STR sections of door tiles (Scope / Time /
// Resources) that carry the active project filter into every project-spanning
// (🔀) door. All the logic lives here so it is unit-tested without the page.

import { describe, expect, it } from "vitest";
import { ClipboardList, FileStack, Forklift, Package, ShoppingCart, Truck } from "lucide-react";

import {
  buildDashboardCards,
  buildProcurementProjectStatus,
  effectiveDoorProjectId,
  parseProcurementSection,
  procurementDoorHref,
  QUICK_DOORS,
  visibleProcurementDoors,
  PROCUREMENT_STR_SECTIONS,
  type DashboardPrRow,
  type HomeCountRow,
} from "@/lib/purchasing/procurement-home";
import {
  CATALOG_LABEL,
  ORDERING_TEMPLATES_LABEL,
  PROJECT_COSTS_LABEL,
  SUPPLY_PLAN_LABEL,
} from "@/lib/i18n/labels";

const TODAY = "2026-07-16";
const NAMES = new Map([
  ["p1", "Alpha"],
  ["p2", "Beta"],
]);

function row(
  projectId: string | null,
  status: HomeCountRow["status"],
  eta: string | null = null,
): HomeCountRow {
  return { projectId, status, eta };
}

describe("buildProcurementProjectStatus", () => {
  it("counts OPEN requests (active bands) per project, excluding done/closed", () => {
    const rows = [
      row("p1", "requested"), // awaiting_approval → open
      row("p1", "approved"), // to_order → open
      row("p1", "delivered"), // done → NOT open
      row("p1", "cancelled"), // closed → NOT open
      row("p2", "on_route"), // in_transit → open
    ];
    const out = buildProcurementProjectStatus(rows, NAMES, TODAY);
    expect(out.find((p) => p.projectId === "p1")?.openCount).toBe(2);
    expect(out.find((p) => p.projectId === "p2")?.openCount).toBe(1);
  });

  it("counts arrivals-today = in_transit rows due-or-overdue (eta<=today) or unknown eta", () => {
    const rows = [
      row("p1", "on_route", "2026-07-16"), // due today → arrival
      row("p1", "purchased", "2026-07-10"), // overdue → arrival
      row("p1", "purchased", null), // unknown eta → arrival (receive pile)
      row("p1", "on_route", "2026-07-20"), // future → NOT today
      row("p1", "approved", "2026-07-16"), // to_order (not in_transit) → NOT an arrival
    ];
    const p1 = buildProcurementProjectStatus(rows, NAMES, TODAY).find((p) => p.projectId === "p1");
    expect(p1?.arrivalsToday).toBe(3);
    expect(p1?.openCount).toBe(5); // all five are active bands
  });

  it("drops project-level (null projectId) rows and unresolved-name projects, sorts by name", () => {
    const rows = [
      row(null, "requested"), // store-bound / project-level → excluded from the per-project strip
      row("p2", "requested"),
      row("p1", "requested"),
      row("p9", "requested"), // p9 has no resolved name → dropped
    ];
    const out = buildProcurementProjectStatus(rows, NAMES, TODAY);
    expect(out.map((p) => p.projectId)).toEqual(["p1", "p2"]); // name-sorted Alpha, Beta; null + p9 gone
    expect(out.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
  });
});

// Spec 327 U1 — the dashboard cards ARE the selection, so the card list comes
// from the caller's FULL RLS projects read (procurement reads all projects), a
// LEFT-join over PR rows: a zero-open-PR project still renders a zero-count
// card (the #621 gap — buildProcurementProjectStatus derives from PR rows and
// vanishes such projects; that stays strip-only until U6 retires it).
describe("buildDashboardCards", () => {
  const PROJECTS = [
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Beta" },
    { id: "p3", name: "Gamma" },
  ];
  // wp1 belongs to p1 and starts before the late etas below; wp2 → p2, undated.
  const WPS = new Map([
    ["wp1", { plannedStart: "2026-07-10", projectId: "p1" }],
    ["wp2", { plannedStart: null, projectId: "p2" }],
  ]);

  function dashRow(overrides: Partial<DashboardPrRow>): DashboardPrRow {
    return {
      projectId: "p1",
      status: "approved",
      eta: null,
      workPackageId: null,
      requestedFromWorkPackageId: null,
      ...overrides,
    };
  }

  it("yields a zero-count card for a zero-PR project (the #621 assertion)", () => {
    const out = buildDashboardCards(PROJECTS, [], WPS, TODAY);
    expect(out.map((c) => c.projectId)).toEqual(["p1", "p2", "p3"]);
    expect(out[0]).toEqual({
      projectId: "p1",
      name: "Alpha",
      openCount: 0,
      arrivalsToday: 0,
      lateRisk: 0,
    });
  });

  it("counts open + arrivals-today per project with the strip rules (PR.project_id grain)", () => {
    const rows = [
      dashRow({ projectId: "p1", status: "requested" }), // open
      dashRow({ projectId: "p1", status: "on_route", eta: "2026-07-16" }), // open + arrival (due today)
      dashRow({ projectId: "p1", status: "purchased", eta: null }), // open + arrival (unknown eta)
      dashRow({ projectId: "p1", status: "on_route", eta: "2026-07-20" }), // open, future → no arrival
      dashRow({ projectId: "p1", status: "delivered" }), // done → not open
      dashRow({ projectId: "p2", status: "approved" }), // open on p2
    ];
    const out = buildDashboardCards(PROJECTS, rows, WPS, TODAY);
    const p1 = out.find((c) => c.projectId === "p1");
    const p2 = out.find((c) => c.projectId === "p2");
    expect(p1?.openCount).toBe(4);
    expect(p1?.arrivalsToday).toBe(2);
    expect(p2?.openCount).toBe(1);
    expect(p2?.arrivalsToday).toBe(0);
  });

  it("attributes late-risk via the ANCHOR WP's project — a store-bound null-project PR counts toward its WP's card (ADR 0065, §0.1)", () => {
    const rows = [
      // project_id NULL but requested_from wp1 (p1), eta after wp1's start → p1 late-risk
      dashRow({
        projectId: null,
        status: "purchased",
        eta: "2026-07-20",
        requestedFromWorkPackageId: "wp1",
      }),
      // direct WP-bound, same lateness → p1 late-risk
      dashRow({ projectId: "p1", status: "approved", eta: "2026-07-15", workPackageId: "wp1" }),
      // anchor WP undated → never late-risk
      dashRow({ projectId: "p2", status: "approved", eta: "2026-07-20", workPackageId: "wp2" }),
    ];
    const out = buildDashboardCards(PROJECTS, rows, WPS, TODAY);
    expect(out.find((c) => c.projectId === "p1")?.lateRisk).toBe(2);
    expect(out.find((c) => c.projectId === "p2")?.lateRisk).toBe(0);
  });

  it("sorts cards by project name", () => {
    const shuffled = [
      { id: "p3", name: "Gamma" },
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ];
    const out = buildDashboardCards(shuffled, [], WPS, TODAY);
    expect(out.map((c) => c.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("PROCUREMENT_STR_SECTIONS", () => {
  it("has exactly the three STR sections in order", () => {
    expect(PROCUREMENT_STR_SECTIONS.map((s) => s.key)).toEqual(["scope", "time", "resources"]);
  });

  it("files เช่าอุปกรณ์ under Resources as a project-spanning door (moved out of settings)", () => {
    const resources = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources");
    const rental = resources?.doors.find((d) => d.href === "/equipment/rentals");
    expect(rental).toBeDefined();
    expect(rental?.scope).toBe("spanning");
  });

  it("puts จัดซื้อ under Scope and ใบสั่งซื้อ under Time (D2)", () => {
    const scope = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope");
    const time = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "time");
    expect(scope?.doors.some((d) => d.href === "/requests")).toBe(true);
    expect(time?.doors.some((d) => d.href === "/requests/orders")).toBe(true);
  });

  // Spec 326 — WP-list reachability. The STR spine dropped the pre-323 โครงการ
  // tab and the hub links /requests?project=, so procurement (a first-class
  // read-only viewer of /projects/[id], spec 173) had NO discoverable entry to
  // any /projects surface. One shared door restores it. Shared, NOT 📍 project
  // scope: a project door hides while 2+ projects have no lens selection, which
  // would re-open the gap in the hub's default state.
  it("puts a shared โครงการ door under Scope right after จัดซื้อ (spec 326)", () => {
    const scope = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope");
    const idx = scope?.doors.findIndex((d) => d.key === "projects") ?? -1;
    const door = scope?.doors[idx];
    expect(door?.label).toBe("โครงการ");
    expect(door?.href).toBe("/projects");
    expect(door?.scope).toBe("shared");
    expect(scope?.doors[idx - 1]?.key).toBe("requests");
    // an active project must never leak onto the hub target (shared passthrough)
    expect(procurementDoorHref(door!, "p1")).toBe("/projects");
  });

  it("labels the /catalog door with CATALOG_LABEL (term SSOT — the catalog is ทะเบียนวัสดุ everywhere)", () => {
    const scope = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope");
    const catalog = scope?.doors.find((d) => d.href === "/catalog");
    expect(catalog?.label).toBe(CATALOG_LABEL);
  });

  it("labels the ordering-templates door with ORDERING_TEMPLATES_LABEL (term SSOT — the tile must match its own page, and read as a TEMPLATE not a plan)", () => {
    const scope = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope");
    const templates = scope?.doors.find((d) => d.key === "ordering-templates");
    expect(templates?.label).toBe(ORDERING_TEMPLATES_LABEL);
  });

  it("puts แผนจัดหา under Scope as a project-scope door with the SUPPLY_PLAN_LABEL SSOT", () => {
    const scope = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope");
    const plan = scope?.doors.find((d) => d.key === "supply-plan");
    expect(plan?.label).toBe(SUPPLY_PLAN_LABEL);
    expect(plan?.scope).toBe("project");
  });
});

describe("procurementDoorHref", () => {
  const spanning = {
    key: "requests",
    label: "จัดซื้อ",
    href: "/requests",
    scope: "spanning",
    icon: ShoppingCart,
  } as const;
  const shared = {
    key: "catalog",
    label: CATALOG_LABEL,
    href: "/catalog",
    scope: "shared",
    icon: Package,
  } as const;
  const spanningWithQuery = {
    key: "incoming",
    label: "ของเข้า",
    href: "/requests?band=in_transit",
    scope: "spanning",
    icon: Truck,
  } as const;

  it("returns the bare href when no project is active", () => {
    expect(procurementDoorHref(spanning, null)).toBe("/requests");
  });

  it("appends ?project= to a project-spanning door when a project is active", () => {
    expect(procurementDoorHref(spanning, "p1")).toBe("/requests?project=p1");
  });

  it("merges ?project= into a spanning door that already has a query", () => {
    expect(procurementDoorHref(spanningWithQuery, "p1")).toBe(
      "/requests?band=in_transit&project=p1",
    );
  });

  it("never adds a project filter to a shared (🌐) door", () => {
    expect(procurementDoorHref(shared, "p1")).toBe("/catalog");
  });
});

// Spec 325 U3 — the ต้นทุนโครงการ hub door. Target is INHERENTLY per-project
// (/projects/[id]/costs), so it's a new 📍 "project" door scope: href resolves
// to the active project's costs page, and the door renders ONLY while the lens
// has an active project (a door that sometimes dead-ends fails §0).
describe("project-scope door (ต้นทุนโครงการ)", () => {
  const costsDoor = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")?.doors.find(
    (d) => d.key === "costs",
  );

  it("exists under Resources with the PROJECT_COSTS_LABEL SSOT and project scope", () => {
    expect(costsDoor).toBeDefined();
    expect(costsDoor?.label).toBe(PROJECT_COSTS_LABEL);
    expect(costsDoor?.scope).toBe("project");
  });

  it("resolves to the active project's costs page", () => {
    expect(procurementDoorHref(costsDoor!, "p1")).toBe("/projects/p1/costs");
  });

  it("falls back to its static href when no project is active (never rendered then)", () => {
    expect(procurementDoorHref(costsDoor!, null)).toBe("/projects");
  });

  it("is hidden by visibleProcurementDoors without an active project, shown with one", () => {
    const resources = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")!;
    const noLens = visibleProcurementDoors(resources, true, null);
    const withLens = visibleProcurementDoors(resources, true, "p1");
    expect(noLens.some((d) => d.key === "costs")).toBe(false);
    expect(withLens.some((d) => d.key === "costs")).toBe(true);
  });

  it("keeps the managerOnly filter behavior for non-managers", () => {
    const resources = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")!;
    const nonManager = visibleProcurementDoors(resources, false, "p1");
    expect(nonManager.some((d) => d.managerOnly)).toBe(false);
    expect(nonManager.some((d) => d.key === "costs")).toBe(true); // not managerOnly
  });

  it("applies both filters at once (non-manager + no lens → neither door class)", () => {
    const resources = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")!;
    const doors = visibleProcurementDoors(resources, false, null);
    expect(doors.some((d) => d.managerOnly)).toBe(false);
    expect(doors.some((d) => d.scope === "project")).toBe(false);
    expect(doors.some((d) => d.key === "payroll")).toBe(true); // ordinary doors intact
  });
});

// The แผนจัดหา (supply plan) hub door — spec 323 follow-up. Same 📍 project scope
// as ต้นทุนโครงการ; its target is /projects/[id]/supply-plan, so the project arm
// must resolve per-door (not the costs hardcode it started as).
describe("project-scope door (แผนจัดหา)", () => {
  const planDoor = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope")?.doors.find(
    (d) => d.key === "supply-plan",
  );

  it("resolves to the active project's supply-plan page (NOT the costs page)", () => {
    expect(procurementDoorHref(planDoor!, "p1")).toBe("/projects/p1/supply-plan");
  });

  it("still resolves the costs door to its own page (door-keyed, no cross-wiring)", () => {
    const costsDoor = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")?.doors.find(
      (d) => d.key === "costs",
    );
    expect(procurementDoorHref(costsDoor!, "p1")).toBe("/projects/p1/costs");
  });

  it("is hidden without an active project, shown with one", () => {
    const scope = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope")!;
    expect(visibleProcurementDoors(scope, false, null).some((d) => d.key === "supply-plan")).toBe(
      false,
    );
    expect(visibleProcurementDoors(scope, false, "p1").some((d) => d.key === "supply-plan")).toBe(
      true,
    );
  });
});

// Guard: EVERY 📍 project-scope door must have a per-project resolver in
// PROJECT_DOOR_HREF. visibleProcurementDoors shows a project door once a project
// is active, so an unmapped door would render but its href would fall through to
// the static "/projects" — a visible dead-end (§0). Assert each resolves to a
// per-project path so a future door can't silently regress.
describe("project-scope doors all resolve (PROJECT_DOOR_HREF exhaustive)", () => {
  const projectDoors = PROCUREMENT_STR_SECTIONS.flatMap((s) => s.doors).filter(
    (d) => d.scope === "project",
  );

  it("has at least the costs + supply-plan project doors", () => {
    expect(projectDoors.map((d) => d.key).sort()).toEqual(["costs", "supply-plan"]);
  });

  it("resolves every project-scope door to a per-project href (never the static fallback)", () => {
    for (const door of projectDoors) {
      const href = procurementDoorHref(door, "pX");
      expect(href, door.key).toContain("/projects/pX/");
      expect(href, door.key).not.toBe(door.href);
    }
  });
});

// Spec 327 U6 — the door icon SSOT. Users picked the icon-chip-row-on-top idiom
// (project-page ICON_CHIP precedent); an icon-only row only works if every door
// has an icon, icons are UNIQUE within a row, and each destination wears the
// SAME icon app-wide. The three audited clashes are pinned resolved here:
// จัดซื้อ keeps ShoppingCart (the ขอบเขต tab moved off it), แผนจัดหา keeps the
// project-chip ClipboardList while เทมเพลตแผนจัดหา takes FileStack, and
// เช่าอุปกรณ์ = Forklift everywhere (settings hub realigned off Banknote).
describe("door icons (spec 327 U6 icon SSOT)", () => {
  it("every door carries an icon", () => {
    for (const s of PROCUREMENT_STR_SECTIONS) {
      for (const d of s.doors) {
        // lucide icons are forwardRef exotic components (objects, not fns).
        expect(d.icon, `${s.key}:${d.key}`).toBeTruthy();
      }
    }
  });

  it("icons are unique within each section row (icon-only chips must be tellable-apart)", () => {
    for (const s of PROCUREMENT_STR_SECTIONS) {
      const names = s.doors.map((d) => d.icon.displayName ?? d.icon.name);
      expect(new Set(names).size, s.key).toBe(names.length);
    }
  });

  it("QUICK_DOORS: deliberate order + cross-section icon uniqueness (its own row)", () => {
    expect(QUICK_DOORS.map((d) => d.key)).toEqual(["requests", "incoming", "orders", "catalog"]);
    const names = QUICK_DOORS.map((d) => d.icon.displayName ?? d.icon.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("pins the clash resolutions from the 2026-07-18 consistency audit", () => {
    const door = (section: string, key: string) =>
      PROCUREMENT_STR_SECTIONS.find((s) => s.key === section)?.doors.find((d) => d.key === key);
    expect(door("scope", "requests")?.icon).toBe(ShoppingCart);
    expect(door("scope", "supply-plan")?.icon).toBe(ClipboardList);
    expect(door("scope", "ordering-templates")?.icon).toBe(FileStack);
    expect(door("resources", "rentals")?.icon).toBe(Forklift);
    expect(door("time", "incoming")?.icon).toBe(Truck);
  });
});

// effectiveDoorProjectId — which project a 📍 door resolves to. In a single-
// project world the lens shows no chips (project-lens collapses at ≤1 named), so
// activeProjectId is never set; falling back to the SOLE project keeps the
// project doors reachable (else ต้นทุนโครงการ + แผนจัดหา are invisible for the
// common one-project case). 2+ projects with no selection → null (stay hidden,
// no arbitrary pick).
describe("effectiveDoorProjectId", () => {
  it("uses the explicit lens selection when present", () => {
    expect(effectiveDoorProjectId("p2", [{ id: "p1" }, { id: "p2" }])).toBe("p2");
  });

  it("falls back to the sole project when none is selected", () => {
    expect(effectiveDoorProjectId(null, [{ id: "p1" }])).toBe("p1");
  });

  it("stays null with multiple projects and no selection (no arbitrary pick)", () => {
    expect(effectiveDoorProjectId(null, [{ id: "p1" }, { id: "p2" }])).toBeNull();
  });

  it("stays null with no projects", () => {
    expect(effectiveDoorProjectId(null, [])).toBeNull();
  });
});

// Spec 323 U3b: /procurement/[section] is a dynamic route — the param must be
// validated against the STR section keys (anything else → notFound()). Derived
// from PROCUREMENT_STR_SECTIONS so a section rename cannot drift past this.
describe("parseProcurementSection", () => {
  it("parses each STR section key (the [section] route param)", () => {
    for (const section of PROCUREMENT_STR_SECTIONS) {
      expect(parseProcurementSection(section.key)).toBe(section.key);
    }
  });

  it("rejects any other value with null (the route 404s)", () => {
    for (const bad of ["", "Scope", "SCOPE", "scope/", "settings", "orders", "0"]) {
      expect(parseProcurementSection(bad), bad).toBeNull();
    }
  });
});
