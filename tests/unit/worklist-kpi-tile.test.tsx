// Spec 193 feedback bug: a procurement user reported the amount "overflowing from
// the container" on the worklist KPI hero. The ค้างจ่าย (outstanding) tile holds a
// long ฿ string (e.g. millions) while the other tiles hold small counts; at the
// shared text-3xl with no width/wrap guard it overflowed the half-width phone tile.
// The fix: the money tile value renders smaller and is allowed to wrap, and the
// value column can shrink (min-w-0) so a long amount can never spill outside.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { WorklistKpiTile } from "@/components/features/purchasing/worklist-kpi-tile";
import type { WorklistKpiTile as Tile } from "@/lib/purchasing/worklist-kpis";

const COUNT_TILE: Tile = {
  key: "to_order",
  label: "รอสั่งซื้อ",
  value: "5",
  caption: "พร้อมออกใบสั่งซื้อ",
  tone: "hot",
  icon: "waiting",
  href: "/requests?band=to_order",
  active: false,
};

const MONEY_TILE: Tile = {
  key: "outstanding",
  label: "ค้างจ่าย",
  value: "฿12,345,678",
  caption: "ยังไม่ชำระ",
  tone: "neutral",
  icon: "outstanding",
  href: null,
  active: false,
};

describe("WorklistKpiTile overflow guard", () => {
  it("the money (ค้างจ่าย) tile value renders smaller and wraps so it cannot overflow", () => {
    const { getByText } = render(<WorklistKpiTile tile={MONEY_TILE} />);
    const value = getByText("฿12,345,678");
    // Smaller than the count tiles' text-3xl — a long ฿ string fits the half-width tile.
    expect(value.className).not.toContain("text-3xl");
    // Allowed to break/wrap rather than spill outside the container.
    expect(value.className).toContain("break-words");
    // Its column can shrink inside the flex card (otherwise wrapping never kicks in).
    expect(value.parentElement?.className).toContain("min-w-0");
  });

  it("the count tiles keep the big text-3xl value (short, never overflows)", () => {
    const { getByText } = render(<WorklistKpiTile tile={COUNT_TILE} />);
    const value = getByText("5");
    expect(value.className).toContain("text-3xl");
  });
});
