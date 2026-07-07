// The เดือนนี้สั่งซื้อ tile shows a spend-vs-last-month delta. A rising cost must
// NOT wear a growth-chart TrendingUp glyph (reads as "up = good"); it uses a plain
// directional arrow, and no comparison shows a neutral dash.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcurementHomeTiles } from "@/components/features/purchasing/procurement-home-tiles";

const PENDING = { count: 0, worstAgingDays: null };

function renderTiles(pctChange: number | null) {
  return render(
    <ProcurementHomeTiles
      monthTrend={{ currentMonth: 1000, previousMonth: 900, pctChange }}
      pendingPoSummary={PENDING}
      pendingStoreReceiptCount={0}
    />,
  );
}

describe("ProcurementHomeTiles spend-trend glyph", () => {
  it("rising spend shows a plain up arrow, not a growth-chart TrendingUp", () => {
    const { container } = renderTiles(12);
    expect(container.querySelector(".lucide-arrow-up")).toBeInTheDocument();
    expect(container.querySelector(".lucide-trending-up")).not.toBeInTheDocument();
  });

  it("falling spend shows a plain down arrow", () => {
    const { container } = renderTiles(-8);
    expect(container.querySelector(".lucide-arrow-down")).toBeInTheDocument();
    expect(container.querySelector(".lucide-trending-down")).not.toBeInTheDocument();
  });

  it("no comparison (null) shows a neutral dash, not an arrow", () => {
    const { container } = renderTiles(null);
    expect(container.querySelector(".lucide-minus")).toBeInTheDocument();
    expect(container.querySelector(".lucide-arrow-up")).not.toBeInTheDocument();
  });
});
