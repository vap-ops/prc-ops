import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectCostsView } from "@/app/projects/[projectId]/costs/costs-view";
import type { WpCostRow } from "@/lib/costs/wp-cost-breakdown";

// Spec 325 Phase 1 U2 — the per-project cost view: two family tiles (ค่าวัสดุ /
// ค่าดำเนินการ), per-WP cards (material + labour), disclosures (awaiting-price,
// multi-project rental, store pool), zero-cost WPs collapsed to a count line.

const wpRow = (over: Partial<WpCostRow> & { wpId: string; code: string }): WpCostRow => ({
  name: null,
  material: { purchases: 0, storeIssues: 0, storeReturns: 0, net: 0, awaitingPriceCount: 0 },
  labour: 0,
  laborBudget: null,
  total: 0,
  ...over,
});

const families = {
  material: { wpBound: 1150, storePool: 300, total: 1450 },
  execution: { labour: 900, equipment: 3000, total: 3900 },
  grand: 5350,
};

describe("ProjectCostsView", () => {
  it("renders family tiles with equipment inside execution and the store pool disclosed", () => {
    render(
      <ProjectCostsView
        rows={[]}
        families={families}
        rental={{ attributed: 3000, multiProjectNet: 0 }}
      />,
    );
    expect(screen.getByText("ค่าวัสดุ")).toBeInTheDocument();
    expect(screen.getByText("ค่าดำเนินการ")).toBeInTheDocument();
    // family amounts
    expect(screen.getByText("฿1,450.00")).toBeInTheDocument();
    expect(screen.getByText("฿3,900.00")).toBeInTheDocument();
    // sub-lines: store pool under material, labour + equipment under execution
    expect(screen.getByText(/พักในคลังโครงการ/)).toBeInTheDocument();
    expect(screen.getByText(/ค่าเช่าอุปกรณ์/)).toBeInTheDocument();
  });

  it("renders WP cards sorted by spend with material+labour lines and collapses zero-cost WPs", () => {
    render(
      <ProjectCostsView
        rows={[
          wpRow({
            wpId: "a",
            code: "A01",
            name: "งานผนัง",
            material: {
              purchases: 100,
              storeIssues: 0,
              storeReturns: 0,
              net: 100,
              awaitingPriceCount: 0,
            },
            labour: 50,
            total: 150,
          }),
          wpRow({
            wpId: "b",
            code: "B02",
            name: "งานพื้น",
            material: {
              purchases: 900,
              storeIssues: 0,
              storeReturns: 0,
              net: 900,
              awaitingPriceCount: 2,
            },
            labour: 0,
            total: 900,
          }),
          wpRow({
            wpId: "c",
            code: "C03",
            name: "รอราคา",
            material: {
              purchases: 0,
              storeIssues: 0,
              storeReturns: 0,
              net: 0,
              awaitingPriceCount: 1,
            },
            total: 0,
          }),
          wpRow({ wpId: "z", code: "Z09", name: "ยังไม่เริ่ม" }),
        ]}
        families={families}
        rental={{ attributed: 0, multiProjectNet: 0 }}
      />,
    );
    const cards = screen.getAllByTestId("wp-cost-card");
    // zero-cost Z09 collapses; zero-total C03 is CARDED (unpriced PR must not
    // read as "no cost" — §0 honesty), so 3 cards + 1 collapsed.
    expect(cards).toHaveLength(3);
    // sorted by total desc: B02 first; zero-total C03 last
    expect(cards[0]!.textContent).toContain("B02");
    expect(cards[1]!.textContent).toContain("A01");
    expect(cards[2]!.textContent).toContain("C03");
    // awaiting-price disclosure on the cards that have it
    expect(cards[0]!.textContent).toContain("รอราคา 2 รายการ");
    expect(cards[2]!.textContent).toContain("รอราคา 1 รายการ");
    // the collapsed remainder line counts ONLY the truly cost-less WP
    expect(screen.getByText(/อีก 1 งาน/)).toBeInTheDocument();
  });

  it("renders an explicit empty state when the project has no WPs at all", () => {
    render(
      <ProjectCostsView
        rows={[]}
        families={families}
        rental={{ attributed: 0, multiProjectNet: 0 }}
      />,
    );
    expect(screen.getByText("ยังไม่มีงานในโครงการ")).toBeInTheDocument();
    expect(screen.queryByTestId("wp-cost-card")).not.toBeInTheDocument();
  });

  it("discloses multi-project rental net when present and hides it when zero", () => {
    const { rerender } = render(
      <ProjectCostsView
        rows={[]}
        families={families}
        rental={{ attributed: 1000, multiProjectNet: 5000 }}
      />,
    );
    expect(screen.getByText(/หลายโครงการ/)).toBeInTheDocument();
    rerender(
      <ProjectCostsView
        rows={[]}
        families={families}
        rental={{ attributed: 1000, multiProjectNet: 0 }}
      />,
    );
    expect(screen.queryByText(/หลายโครงการ/)).not.toBeInTheDocument();
  });

  it("shows the labour budget beside labour when set", () => {
    render(
      <ProjectCostsView
        rows={[
          wpRow({
            wpId: "a",
            code: "A01",
            labour: 900,
            laborBudget: 5000,
            total: 900,
          }),
        ]}
        families={families}
        rental={{ attributed: 0, multiProjectNet: 0 }}
      />,
    );
    const card = screen.getByTestId("wp-cost-card");
    expect(card.textContent).toContain("งบค่าแรง");
    expect(card.textContent).toContain("฿5,000.00");
  });
});
