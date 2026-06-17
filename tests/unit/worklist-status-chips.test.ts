import { describe, expect, it } from "vitest";
import { buildWorklistStatusChips } from "@/lib/purchasing/worklist-status-chips";
import type { ProcurementFilter } from "@/lib/purchasing/worklist-filter";

// Spec 138 U3 — the scrollable status-chip filter with live counts. Pure, TDD-first.
// Chips are BAND-level (ทั้งหมด / อนุมัติแล้ว=to_order / กำลังจัดส่ง=in_transit / เกินกำหนด=overdue);
// counts reuse the spec-105 procurementSummary and are live to the supplier/project axes.

const NONE: ProcurementFilter = {
  supplier: null,
  projectId: null,
  overdue: false,
  status: null,
  band: null,
};
const TODAY = "2026-06-15";

// A representative pipeline set: 2 to_order, 2 in_transit (1 overdue), 1 awaiting, 1 received,
// 1 banded-out (cancelled — excluded from every count).
const ROWS = [
  { status: "approved", eta: null },
  { status: "approved", eta: null },
  { status: "purchased", eta: "2026-06-10" }, // in_transit + past eta → overdue
  { status: "on_route", eta: "2026-06-20" }, // in_transit, future eta
  { status: "requested", eta: null }, // awaiting_approval
  { status: "delivered", eta: null }, // received
  { status: "cancelled", eta: null }, // no band
];

describe("buildWorklistStatusChips", () => {
  it("returns the four chips in order: all, to_order, in_transit, overdue", () => {
    const chips = buildWorklistStatusChips({ rows: ROWS, filter: NONE, todayIso: TODAY });
    expect(chips.map((c) => c.key)).toEqual(["all", "to_order", "in_transit", "overdue"]);
    expect(chips.map((c) => c.label)).toEqual([
      "ทั้งหมด",
      "อนุมัติแล้ว",
      "กำลังจัดส่ง",
      "เกินกำหนด",
    ]);
  });

  it("counts each band live (all = pipeline rows, excludes banded-out cancelled)", () => {
    const chips = buildWorklistStatusChips({ rows: ROWS, filter: NONE, todayIso: TODAY });
    const count = (k: string) => chips.find((c) => c.key === k)!.count;
    expect(count("all")).toBe(6); // 7 rows − 1 cancelled (no band)
    expect(count("to_order")).toBe(2);
    expect(count("in_transit")).toBe(2);
    expect(count("overdue")).toBe(1);
  });

  it("builds each chip's href, band/overdue set per chip", () => {
    const chips = buildWorklistStatusChips({ rows: ROWS, filter: NONE, todayIso: TODAY });
    const href = (k: string) => chips.find((c) => c.key === k)!.href;
    expect(href("all")).toBe("/requests");
    expect(href("to_order")).toBe("/requests?band=to_order");
    expect(href("in_transit")).toBe("/requests?band=in_transit");
    expect(href("overdue")).toBe("/requests?overdue=1");
  });

  it("preserves the supplier/project axes in every chip href (live filter)", () => {
    const filter: ProcurementFilter = { ...NONE, supplier: "TPI", projectId: "p1" };
    const chips = buildWorklistStatusChips({ rows: ROWS, filter, todayIso: TODAY });
    const href = (k: string) => chips.find((c) => c.key === k)!.href;
    expect(href("all")).toBe("/requests?supplier=TPI&project=p1");
    expect(href("to_order")).toBe("/requests?supplier=TPI&project=p1&band=to_order");
    expect(href("overdue")).toBe("/requests?supplier=TPI&project=p1&overdue=1");
  });

  it("marks the active chip: all when no band/overdue", () => {
    const chips = buildWorklistStatusChips({ rows: ROWS, filter: NONE, todayIso: TODAY });
    expect(chips.filter((c) => c.active).map((c) => c.key)).toEqual(["all"]);
  });

  it("marks the active chip: the selected band", () => {
    const chips = buildWorklistStatusChips({
      rows: ROWS,
      filter: { ...NONE, band: "to_order" },
      todayIso: TODAY,
    });
    expect(chips.filter((c) => c.active).map((c) => c.key)).toEqual(["to_order"]);
  });

  it("marks the active chip: overdue wins over band", () => {
    const chips = buildWorklistStatusChips({
      rows: ROWS,
      filter: { ...NONE, overdue: true, band: "in_transit" },
      todayIso: TODAY,
    });
    expect(chips.filter((c) => c.active).map((c) => c.key)).toEqual(["overdue"]);
  });
});
