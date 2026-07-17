// Writing failing test first.
//
// Spec 323 U3a — the Procurement Home hub's pure core. The hub (src/app/
// procurement/page.tsx) is a portfolio landing: a per-project status strip
// (open ขอซื้อ count + arrivals-today count, derived from the caller's visible
// purchase_requests) and three STR sections of door tiles (Scope / Time /
// Resources) that carry the active project filter into every project-spanning
// (🔀) door. All the logic lives here so it is unit-tested without the page.

import { describe, expect, it } from "vitest";

import {
  buildProcurementProjectStatus,
  parseProcurementSection,
  procurementDoorHref,
  procurementStripHref,
  PROCUREMENT_STR_SECTIONS,
  type HomeCountRow,
} from "@/lib/purchasing/procurement-home";
import { CATALOG_LABEL } from "@/lib/i18n/labels";

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

describe("procurementStripHref", () => {
  // Nav-coherence feedback 2026-07-17 (zeeparn): the strip row LOOKS like "open
  // this project's ขอซื้อ" but only re-scoped the hub filter — invisible for a
  // single-project user. The tap now goes WHERE THE COUNTS POINT: the จัดซื้อ
  // list scoped to that project. No ?from= — /requests is a tab page (no back
  // chip); the หน้าหลัก tab is the way back.
  it("targets the project-scoped จัดซื้อ list", () => {
    expect(procurementStripHref("p1")).toBe("/requests?project=p1");
  });
});

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

  it("omits a project whose requests are all done/closed (no open work → not on the strip)", () => {
    const rows = [row("p1", "delivered"), row("p1", "cancelled")];
    expect(buildProcurementProjectStatus(rows, NAMES, TODAY)).toEqual([]);
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

  it("labels the /catalog door with CATALOG_LABEL (term SSOT — the catalog is ทะเบียนวัสดุ everywhere)", () => {
    const scope = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope");
    const catalog = scope?.doors.find((d) => d.href === "/catalog");
    expect(catalog?.label).toBe(CATALOG_LABEL);
  });
});

describe("procurementDoorHref", () => {
  const spanning = {
    key: "requests",
    label: "จัดซื้อ",
    href: "/requests",
    scope: "spanning",
  } as const;
  const shared = {
    key: "catalog",
    label: CATALOG_LABEL,
    href: "/catalog",
    scope: "shared",
  } as const;
  const spanningWithQuery = {
    key: "incoming",
    label: "ของเข้า",
    href: "/requests?band=in_transit",
    scope: "spanning",
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
