import { describe, expect, it } from "vitest";
import { PROCUREMENT_BAND_LABEL, PROCUREMENT_BANDS } from "@/lib/purchasing/procurement-pipeline";
import { buildWorklistStatusChips } from "@/lib/purchasing/worklist-status-chips";
import { buildWorklistKpis } from "@/lib/purchasing/worklist-kpis";
import type { ProcurementFilter } from "@/lib/purchasing/worklist-filter";

// Spec 211 U7 — a worklist band must read ONE way across the three places it shows
// on the procurement screen: the pipeline band header, the status-chip filter, and
// the KPI tile. It used to drift — to_order was "รอสั่งซื้อ" on the header/tile but
// "อนุมัติแล้ว" on the chip. Guard: all three derive from PROCUREMENT_BAND_LABEL.

const FILTER: ProcurementFilter = {
  supplier: null,
  projectId: null,
  overdue: false,
  status: null,
  band: null,
};

describe("procurement band label SSOT (spec 211 U7)", () => {
  const chips = buildWorklistStatusChips({ rows: [], filter: FILTER, todayIso: "2026-06-15" });
  const kpis = buildWorklistKpis({
    summary: { toOrder: 0, inTransit: 0, overdue: 0 },
    outstanding: "฿0",
    filter: FILTER,
  });
  const chipLabel = (k: string) => chips.find((c) => c.key === k)?.label;
  const kpiLabel = (k: string) => kpis.find((t) => t.key === k)?.label;
  const bandLabel = (b: string) => PROCUREMENT_BANDS.find((m) => m.band === b)?.label;

  it("uses one label for to_order across chip, KPI tile, and pipeline header", () => {
    expect(chipLabel("to_order")).toBe(PROCUREMENT_BAND_LABEL.to_order);
    expect(kpiLabel("to_order")).toBe(PROCUREMENT_BAND_LABEL.to_order);
    expect(bandLabel("to_order")).toBe(PROCUREMENT_BAND_LABEL.to_order);
  });

  it("uses one label for in_transit across chip, KPI tile, and pipeline header", () => {
    expect(chipLabel("in_transit")).toBe(PROCUREMENT_BAND_LABEL.in_transit);
    expect(kpiLabel("in_transit")).toBe(PROCUREMENT_BAND_LABEL.in_transit);
    expect(bandLabel("in_transit")).toBe(PROCUREMENT_BAND_LABEL.in_transit);
  });

  it("uses one label for overdue across chip and KPI tile", () => {
    expect(chipLabel("overdue")).toBe(PROCUREMENT_BAND_LABEL.overdue);
    expect(kpiLabel("overdue")).toBe(PROCUREMENT_BAND_LABEL.overdue);
  });
});
