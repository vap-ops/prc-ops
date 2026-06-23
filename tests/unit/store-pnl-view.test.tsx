// Spec 178 U6 — the Store P&L view on /store (super/director only). A read-only
// presentational summary: per-item cost / sell / margin / shrinkage + the project
// net. Pure component (props in, JSX out).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StorePnlView, type StorePnlRow } from "@/components/features/store/store-pnl-view";

const rows: StorePnlRow[] = [
  {
    catalogItemId: "ci1",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    qtyIssued: 15,
    costTotal: 450,
    sellTotal: 750,
    margin: 300,
    shrinkageValue: -60,
  },
  {
    catalogItemId: "ci2",
    baseItem: "ท่อ PVC",
    specAttrs: null,
    qtyIssued: 4,
    costTotal: 20,
    sellTotal: 20,
    margin: 0,
    shrinkageValue: 0,
  },
];

describe("StorePnlView", () => {
  it("shows each item and the project net (Σ margin + Σ shrinkage)", () => {
    render(<StorePnlView rows={rows} />);
    expect(screen.getByText("สายไฟ NYY")).toBeInTheDocument();
    expect(screen.getByText("ท่อ PVC")).toBeInTheDocument();
    // Net = (300 + 0) margin + (−60 + 0) shrinkage = 240.
    expect(screen.getByText(/กำไรสุทธิ/)).toBeInTheDocument();
    expect(screen.getByText(/฿240/)).toBeInTheDocument();
  });

  it("renders an empty-state when there is no P&L yet", () => {
    render(<StorePnlView rows={[]} />);
    expect(screen.getByText(/ยังไม่มี/)).toBeInTheDocument();
  });
});
