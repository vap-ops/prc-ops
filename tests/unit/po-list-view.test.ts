// Writing failing test first.
//
// Spec 262 U3 — the PO list page's pure view layer. A row aggregates a PO's
// member lines (reusing buildPoDetailView for status/total, spec 260's
// charges-aware grand total) plus which project(s) its ACTIVE lines touch
// (isActiveLine, exported from po-detail.ts — same exclusion, not copied) and
// how many days it has been waiting (aging, undelivered POs only).

import { describe, expect, it } from "vitest";
import {
  buildPoListRow,
  deriveProjectLabel,
  poAgingDays,
  filterPoRows,
  sortPoRowsByOrderedAtDesc,
  type PoListRow,
  type PoListAggregateInput,
} from "@/lib/purchasing/po-list-view";

describe("deriveProjectLabel", () => {
  const names = new Map([
    ["p1", "โครงการ A"],
    ["p2", "โครงการ B"],
  ]);

  it("is a dash for no active projects", () => {
    expect(deriveProjectLabel([], names)).toBe("—");
  });

  it("is the project's name for a single project", () => {
    expect(deriveProjectLabel(["p1", "p1"], names)).toBe("โครงการ A");
  });

  it("is 'หลายโครงการ' for a PO spanning more than one project", () => {
    expect(deriveProjectLabel(["p1", "p2"], names)).toBe("หลายโครงการ");
  });
});

describe("poAgingDays", () => {
  it("is null once received (nothing to chase)", () => {
    expect(poAgingDays("2026-06-01", "received", "2026-07-04")).toBeNull();
  });

  it("is null when never ordered (no ordered_at)", () => {
    expect(poAgingDays(null, "open", "2026-07-04")).toBeNull();
  });

  it("counts whole days since ordered_at for an undelivered PO", () => {
    expect(poAgingDays("2026-06-20", "ordered", "2026-07-04")).toBe(14);
    expect(poAgingDays("2026-07-04", "in_transit", "2026-07-04")).toBe(0);
  });
});

describe("buildPoListRow", () => {
  const projectNames = new Map([["p1", "โครงการ A"]]);

  it("aggregates lines + charges into a display row via buildPoDetailView", () => {
    const input: PoListAggregateInput = {
      id: "po1",
      poNumber: 12,
      supplierId: "s1",
      supplierLabel: "ผู้ขาย A",
      orderedAt: "2026-06-20",
      lines: [
        { status: "purchased", amount: 1000, projectId: "p1" },
        { status: "purchased", amount: 500, projectId: "p1" },
        { status: "rejected", amount: 999999, projectId: "p1" }, // excluded
      ],
      charges: [{ charge_type: "transport", amount: 100 }],
    };
    const row = buildPoListRow(input, projectNames, "2026-07-04");
    expect(row).toEqual<PoListRow>({
      id: "po1",
      poNumber: 12,
      supplierId: "s1",
      supplierLabel: "ผู้ขาย A",
      projectIds: ["p1"],
      projectLabel: "โครงการ A",
      lineCount: 2,
      total: 1600, // 1000 + 500 + 100 transport
      status: "ordered",
      orderedAt: "2026-06-20",
      agingDays: 14,
    });
  });

  it("has no aging once every active line is delivered (received)", () => {
    const input: PoListAggregateInput = {
      id: "po2",
      poNumber: 13,
      supplierId: "s1",
      supplierLabel: "ผู้ขาย A",
      orderedAt: "2026-06-01",
      lines: [{ status: "delivered", amount: 200, projectId: "p1" }],
      charges: [],
    };
    const row = buildPoListRow(input, projectNames, "2026-07-04");
    expect(row.status).toBe("received");
    expect(row.agingDays).toBeNull();
  });
});

describe("filterPoRows", () => {
  const row = (over: Partial<PoListRow>): PoListRow => ({
    id: "id",
    poNumber: 1,
    supplierId: "s1",
    supplierLabel: "sup",
    projectIds: ["p1"],
    projectLabel: "โครงการ A",
    lineCount: 1,
    total: 100,
    status: "ordered",
    orderedAt: "2026-07-01",
    agingDays: 3,
    ...over,
  });
  const rows = [
    row({ id: "a", supplierId: "s1", projectIds: ["p1"] }),
    row({ id: "b", supplierId: "s2", projectIds: ["p2"] }),
    row({ id: "c", supplierId: "s1", projectIds: ["p2"] }),
  ];

  it("narrows by supplier", () => {
    expect(filterPoRows(rows, { supplierId: "s1" }).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("narrows by project membership", () => {
    expect(filterPoRows(rows, { projectId: "p2" }).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("narrows by both", () => {
    expect(filterPoRows(rows, { supplierId: "s1", projectId: "p2" }).map((r) => r.id)).toEqual([
      "c",
    ]);
  });

  it("is a no-op filter with neither set", () => {
    expect(filterPoRows(rows, {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("narrows to undelivered POs only (pendingOnly, the U4 tile's pre-filter)", () => {
    const pending = [
      row({ id: "a", agingDays: 5 }),
      row({ id: "b", agingDays: null }), // received
      row({ id: "c", agingDays: 0 }),
    ];
    expect(filterPoRows(pending, { pendingOnly: true }).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("sortPoRowsByOrderedAtDesc", () => {
  const row = (id: string, orderedAt: string | null): PoListRow => ({
    id,
    poNumber: 1,
    supplierId: "s1",
    supplierLabel: "sup",
    projectIds: [],
    projectLabel: "—",
    lineCount: 1,
    total: 100,
    status: "ordered",
    orderedAt,
    agingDays: null,
  });

  it("sorts newest ordered_at first, nulls last", () => {
    const rows = [row("a", "2026-06-01"), row("b", null), row("c", "2026-07-01")];
    expect(sortPoRowsByOrderedAtDesc(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
