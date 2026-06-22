// Spec 176 U5 — the read-only planning-accuracy surface. Load-bearing: it sums
// the per-WP rows into project totals, highlights the unplanned-miss tally (the
// number that counts against the PM), labels the null-WP row "ทั้งโครงการ", and
// shows an empty state when there's nothing to measure.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SupplyPlanAccuracy,
  type AccuracyRow,
} from "@/components/features/supply-plan/supply-plan-accuracy";

const ROWS: AccuracyRow[] = [
  {
    workPackageId: "11111111-1111-1111-1111-00000000a000",
    wpCode: "WP-A",
    wpName: "งานเอ",
    plannedLines: 2,
    plannedQty: 15,
    unplannedMiss: 2,
    fairReactive: 1,
    untagged: 1,
  },
  {
    workPackageId: "11111111-1111-1111-1111-00000000b000",
    wpCode: "WP-B",
    wpName: "งานบี",
    plannedLines: 0,
    plannedQty: 0,
    unplannedMiss: 1,
    fairReactive: 0,
    untagged: 0,
  },
  {
    workPackageId: null,
    wpCode: null,
    wpName: null,
    plannedLines: 1,
    plannedQty: 3,
    unplannedMiss: 0,
    fairReactive: 0,
    untagged: 0,
  },
];

describe("SupplyPlanAccuracy (spec 176 U5)", () => {
  it("sums the per-WP rows into project totals", () => {
    render(<SupplyPlanAccuracy rows={ROWS} />);
    expect(screen.getByText("ความแม่นยำการวางแผน")).toBeInTheDocument();
    expect(screen.getByTestId("acc-total-planned").textContent).toContain("3");
    expect(screen.getByTestId("acc-total-miss").textContent).toContain("3");
    expect(screen.getByTestId("acc-total-fair").textContent).toContain("1");
    expect(screen.getByTestId("acc-total-untagged").textContent).toContain("1");
  });

  it("labels each WP row and shows the site-general row as ทั้งโครงการ", () => {
    render(<SupplyPlanAccuracy rows={ROWS} />);
    expect(screen.getByText("WP-A")).toBeInTheDocument();
    expect(screen.getByText("WP-B")).toBeInTheDocument();
    expect(screen.getByText("ทั้งโครงการ")).toBeInTheDocument();
  });

  it("shows an empty state when there is nothing to measure", () => {
    render(<SupplyPlanAccuracy rows={[]} />);
    expect(screen.getByText("ยังไม่มีข้อมูลการวัด")).toBeInTheDocument();
  });
});
