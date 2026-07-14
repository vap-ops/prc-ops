// Writing failing test first.
//
// Spec 301 U3 — the letter-code sweep reaches the supply-plan + store surfaces.
// Two render modes: components render <WpCategoryCode> (icon + letter), but the
// supply-plan WP picker is a NATIVE <select> — options carry no markup, so the
// letter-code there is TEXT-ONLY via the new pure wpDisplayCode (same swap,
// no icon/color). Uncategorised WPs degrade to the raw code everywhere.
// NOT in scope: store-manager / store-count-manager "{p.code}" — those are
// PROJECT codes (โครงการ picker), not WP codes.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { wpDisplayCode } from "@/lib/work-packages/format-code";
import { buildWpPickerGroups } from "@/lib/work-packages/picker-options";
import { MaterialLogView } from "@/components/features/store/material-log-view";
import { buildMaterialLog } from "@/lib/store/material-log";
import {
  SupplyPlanAccuracy,
  type AccuracyRow,
} from "@/components/features/supply-plan/supply-plan-accuracy";

describe("wpDisplayCode (spec 301 U3 — text-only letter swap)", () => {
  it("swaps the WP prefix for the category letter", () => {
    expect(wpDisplayCode("WP-01", "W05")).toBe("E-01");
    expect(wpDisplayCode("WP-02-02", "W01")).toBe("P-02-02");
  });

  it("passes through unchanged without a category (or an unknown one)", () => {
    expect(wpDisplayCode("WP-01", null)).toBe("WP-01");
    expect(wpDisplayCode("WP-01", "W99")).toBe("WP-01");
  });
});

describe("buildWpPickerGroups threads categoryCode (spec 301 U3)", () => {
  it("keeps each option's categoryCode for the text letter-code", () => {
    const groups = buildWpPickerGroups([
      { id: "g1", code: "WP-01", name: "งาน", isGroup: true, parentId: null, categoryCode: "W05" },
      {
        id: "w1",
        code: "WP-01-01",
        name: "ย่อย",
        isGroup: false,
        parentId: "g1",
        categoryCode: "W05",
      },
    ]);
    expect(groups.sections[0]?.options[0]?.categoryCode).toBe("W05");
    // the งาน heading letter-codes as text too (native optgroup label).
    expect(groups.sections[0]?.label).toBe("E-01 งาน");
  });
});

describe("MaterialLogView letter-codes the movement WP (spec 301 U3)", () => {
  const sources = {
    receipts: [],
    issues: [
      {
        id: "i1",
        at: "2026-07-01",
        createdAt: "2026-07-01T08:00:00Z",
        qty: 3,
        unitCost: null,
        totalCost: null,
        actorId: null,
        note: null,
        workPackage: { code: "WP-03", name: "ฐานราก", categoryCode: "W01" },
      },
    ],
    counts: [],
    returns: [],
    reversals: [],
  };

  it("renders the letter-code for a categorised WP", () => {
    render(<MaterialLogView entries={buildMaterialLog(sources)} unit="ท่อน" />);
    expect(screen.getByText("P-03")).toBeInTheDocument();
    expect(screen.queryByText("WP-03")).not.toBeInTheDocument();
  });
});

describe("SupplyPlanAccuracy letter-codes the per-WP rows (spec 301 U3)", () => {
  const ROWS: AccuracyRow[] = [
    {
      workPackageId: "w1",
      wpCode: "WP-05",
      wpName: "งานไฟฟ้า",
      categoryCode: "W05",
      plannedLines: 2,
      plannedQty: 10,
      unplannedMiss: 1,
      fairReactive: 0,
      untagged: 0,
    },
  ];

  it("renders the letter-code for a categorised WP row", () => {
    render(<SupplyPlanAccuracy rows={ROWS} />);
    expect(screen.getByText("E-05")).toBeInTheDocument();
    expect(screen.queryByText("WP-05")).not.toBeInTheDocument();
  });
});
