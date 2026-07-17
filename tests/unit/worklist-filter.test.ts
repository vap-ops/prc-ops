import { describe, expect, it } from "vitest";
import {
  buildWorklistQuery,
  distinctProjects,
  distinctSuppliers,
  matchesProcurementFilter,
  sortByPriority,
  type ProcurementFilter,
} from "@/lib/purchasing/worklist-filter";

// Spec 110 — procurement worklist filters + priority sort. Pure, TDD-first.

const NONE: ProcurementFilter = {
  supplier: null,
  projectId: null,
  overdue: false,
  status: null,
  band: null,
};
const TODAY = "2026-06-15";

describe("matchesProcurementFilter", () => {
  const row = {
    status: "purchased",
    eta: "2026-06-10",
    supplier: "TPI",
    projectId: "p1",
  };

  it("passes everything when no filter is set", () => {
    expect(matchesProcurementFilter(row, NONE, TODAY)).toBe(true);
  });

  it("filters by exact supplier", () => {
    expect(matchesProcurementFilter(row, { ...NONE, supplier: "TPI" }, TODAY)).toBe(true);
    expect(matchesProcurementFilter(row, { ...NONE, supplier: "SCG" }, TODAY)).toBe(false);
  });

  it("filters by project id", () => {
    expect(matchesProcurementFilter(row, { ...NONE, projectId: "p1" }, TODAY)).toBe(true);
    expect(matchesProcurementFilter(row, { ...NONE, projectId: "p2" }, TODAY)).toBe(false);
  });

  it("overdue = in-transit band AND eta before today", () => {
    // purchased (in_transit) + eta past → overdue
    expect(matchesProcurementFilter(row, { ...NONE, overdue: true }, TODAY)).toBe(true);
    // eta == today is NOT overdue
    expect(
      matchesProcurementFilter({ ...row, eta: TODAY }, { ...NONE, overdue: true }, TODAY),
    ).toBe(false);
    // no eta → not overdue
    expect(matchesProcurementFilter({ ...row, eta: null }, { ...NONE, overdue: true }, TODAY)).toBe(
      false,
    );
    // approved (to_order, not in transit) even with a past eta → not overdue
    expect(
      matchesProcurementFilter({ ...row, status: "approved" }, { ...NONE, overdue: true }, TODAY),
    ).toBe(false);
  });

  it("filters by procurement band (the spec-138 U3 chip axis)", () => {
    // purchased → in_transit band
    expect(matchesProcurementFilter(row, { ...NONE, band: "in_transit" }, TODAY)).toBe(true);
    expect(matchesProcurementFilter(row, { ...NONE, band: "to_order" }, TODAY)).toBe(false);
    // approved → to_order band
    expect(
      matchesProcurementFilter(
        { ...row, status: "approved" },
        { ...NONE, band: "to_order" },
        TODAY,
      ),
    ).toBe(true);
    // on_route also → in_transit band
    expect(
      matchesProcurementFilter(
        { ...row, status: "on_route" },
        { ...NONE, band: "in_transit" },
        TODAY,
      ),
    ).toBe(true);
    // cancelled has no band → never matches a band filter
    expect(
      matchesProcurementFilter(
        { ...row, status: "cancelled" },
        { ...NONE, band: "in_transit" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("filters by exact status (incl. banded-out rejected/cancelled)", () => {
    expect(matchesProcurementFilter(row, { ...NONE, status: "purchased" }, TODAY)).toBe(true);
    expect(matchesProcurementFilter(row, { ...NONE, status: "cancelled" }, TODAY)).toBe(false);
    expect(
      matchesProcurementFilter(
        { ...row, status: "cancelled" },
        { ...NONE, status: "cancelled" },
        TODAY,
      ),
    ).toBe(true);
  });

  it("AND-composes all axes", () => {
    const f: ProcurementFilter = {
      supplier: "TPI",
      projectId: "p1",
      overdue: true,
      status: "purchased",
      band: "in_transit",
    };
    expect(matchesProcurementFilter(row, f, TODAY)).toBe(true);
    expect(matchesProcurementFilter({ ...row, supplier: "SCG" }, f, TODAY)).toBe(false);
    expect(matchesProcurementFilter({ ...row, status: "on_route" }, f, TODAY)).toBe(false);
  });

  // Feedback 26425c1e (procurement_manager) + 17cba555 (PD): a product-name
  // search box on the worklist ("54-item list, zero search").
  describe("product-name query", () => {
    const named = { ...row, itemName: "ปูนซีเมนต์ ตรา TPI 50kg" };

    it("substring-matches the item name, case-insensitive and trimmed", () => {
      expect(matchesProcurementFilter(named, { ...NONE, query: "ปูน" }, TODAY)).toBe(true);
      expect(matchesProcurementFilter(named, { ...NONE, query: "tpi" }, TODAY)).toBe(true);
      expect(matchesProcurementFilter(named, { ...NONE, query: "  ซีเมนต์  " }, TODAY)).toBe(true);
      expect(matchesProcurementFilter(named, { ...NONE, query: "เหล็ก" }, TODAY)).toBe(false);
    });

    it("excludes a row with no item name once a query is set", () => {
      expect(
        matchesProcurementFilter({ ...named, itemName: null }, { ...NONE, query: "ปูน" }, TODAY),
      ).toBe(false);
    });

    it("a blank/whitespace query matches everything (treated as no filter)", () => {
      expect(matchesProcurementFilter(named, { ...NONE, query: "   " }, TODAY)).toBe(true);
      expect(
        matchesProcurementFilter({ ...named, itemName: null }, { ...NONE, query: "" }, TODAY),
      ).toBe(true);
    });

    it("AND-composes with the other axes", () => {
      expect(
        matchesProcurementFilter(named, { ...NONE, query: "ปูน", supplier: "SCG" }, TODAY),
      ).toBe(false);
    });
  });
});

describe("buildWorklistQuery — product-name query", () => {
  it("serializes a non-blank query as ?q= and drops a blank one", () => {
    expect(buildWorklistQuery({ ...NONE, query: "ปูน" })).toBe(
      "/requests?" + new URLSearchParams({ q: "ปูน" }).toString(),
    );
    expect(buildWorklistQuery({ ...NONE, query: "   " })).toBe("/requests");
    expect(buildWorklistQuery({ ...NONE, supplier: "TPI", query: "ปูน" })).toBe(
      "/requests?" + new URLSearchParams({ supplier: "TPI", q: "ปูน" }).toString(),
    );
  });
});

describe("sortByPriority", () => {
  it("orders critical → urgent → normal", () => {
    const items = [
      { id: "a", priority: "normal" as const },
      { id: "b", priority: "critical" as const },
      { id: "c", priority: "urgent" as const },
    ];
    expect(sortByPriority(items).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("is stable within the same priority (preserves input order)", () => {
    const items = [
      { id: "a", priority: "normal" as const },
      { id: "b", priority: "normal" as const },
      { id: "c", priority: "critical" as const },
      { id: "d", priority: "normal" as const },
    ];
    expect(sortByPriority(items).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("does not mutate the input", () => {
    const items = [
      { id: "a", priority: "normal" as const },
      { id: "b", priority: "critical" as const },
    ];
    sortByPriority(items);
    expect(items.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("distinctSuppliers", () => {
  it("de-dupes, drops null, sorts", () => {
    const rows = [
      { supplier: "TPI" },
      { supplier: null },
      { supplier: "SCG" },
      { supplier: "TPI" },
    ];
    expect(distinctSuppliers(rows)).toEqual(["SCG", "TPI"]);
  });
});

describe("distinctProjects", () => {
  it("de-dupes by id, drops null id, sorts by name", () => {
    const rows = [
      { projectId: "p2", projectName: "Kham Muang" },
      { projectId: "p1", projectName: "Lam Sonthi" },
      { projectId: "p2", projectName: "Kham Muang" },
      { projectId: null, projectName: null },
    ];
    // Sorted by name: "Kham Muang" < "Lam Sonthi".
    expect(distinctProjects(rows)).toEqual([
      { id: "p2", name: "Kham Muang" },
      { id: "p1", name: "Lam Sonthi" },
    ]);
  });
});

describe("buildWorklistQuery", () => {
  it("is bare /requests with no filter", () => {
    expect(buildWorklistQuery(NONE)).toBe("/requests");
  });

  it("serializes set axes and drops empties", () => {
    expect(
      buildWorklistQuery({
        supplier: "TPI",
        projectId: null,
        overdue: true,
        status: null,
        band: null,
      }),
    ).toBe("/requests?supplier=TPI&overdue=1");
  });

  it("composes all axes", () => {
    expect(
      buildWorklistQuery({
        supplier: "SCG",
        projectId: "p1",
        overdue: true,
        status: "cancelled",
        band: "in_transit",
      }),
    ).toBe("/requests?supplier=SCG&project=p1&band=in_transit&status=cancelled&overdue=1");
  });

  it("serializes a status-only filter (surfaces banded-out history)", () => {
    expect(buildWorklistQuery({ ...NONE, status: "rejected" })).toBe("/requests?status=rejected");
  });

  it("serializes the band axis (spec-138 U3 chip)", () => {
    expect(buildWorklistQuery({ ...NONE, band: "to_order" })).toBe("/requests?band=to_order");
    expect(buildWorklistQuery({ ...NONE, supplier: "TPI", band: "in_transit" })).toBe(
      "/requests?supplier=TPI&band=in_transit",
    );
  });

  it("url-encodes the supplier (round-trips through URLSearchParams)", () => {
    const url = buildWorklistQuery({ ...NONE, supplier: "ทีพีไอ คอนกรีต" });
    const qs = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(qs.get("supplier")).toBe("ทีพีไอ คอนกรีต");
  });
});
