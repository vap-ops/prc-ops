// Spec 373 D3 — the summary follows the scope. Under ทั้งหมด the pending-
// reimburse tile must stop claiming "(ของคุณ)" (changed-behaviour relabel rule)
// and the payment-source subtotal line appears with the EXISTING SSOT labels
// (fact-check: บัตรเครดิต/สำรองจ่าย/บริษัทจ่ายตรง, never invented terms).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExpenseSummary } from "@/components/features/expenses/expense-summary";
import { aggregateSourceSpend } from "@/lib/expenses/expense-summary";
import {
  EXPENSE_PENDING_TOTAL_ALL_LABEL,
  EXPENSE_PENDING_TOTAL_LABEL,
  PAYMENT_SOURCE_CARD_LABEL,
  PAYMENT_SOURCE_OWN_LABEL,
} from "@/lib/i18n/labels";

const base = {
  monthLabel: "2026-07",
  monthTotal: 1000,
  pendingReimburse: 500,
  byCategory: [{ label: "เดินทาง", total: 1000 }],
};

describe("spec 373 D3 — aggregateSourceSpend", () => {
  it("sums per payment source, ordered big→small, zero-total sources dropped", () => {
    expect(
      aggregateSourceSpend([
        { paymentSource: "own_money", amount: 100 },
        { paymentSource: "company_card", amount: 400 },
        { paymentSource: "company_card", amount: 300 },
      ]),
    ).toEqual([
      { source: "company_card", total: 700 },
      { source: "own_money", total: 100 },
    ]);
  });
});

describe("spec 373 D3 — ExpenseSummary scope labels", () => {
  it("own scope keeps the personal pending label and shows no source line", () => {
    render(<ExpenseSummary summary={base} />);
    expect(screen.getByText(EXPENSE_PENDING_TOTAL_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(PAYMENT_SOURCE_CARD_LABEL)).not.toBeInTheDocument();
  });

  it("month-mode relabels the tile, chart heading AND empty state (no เดือนนี้ lie)", () => {
    const empty = { ...base, byCategory: [] };
    const { rerender } = render(<ExpenseSummary summary={empty} allScope monthMode="all" />);
    expect(screen.getByText("ใช้จ่ายรวมทุกเดือน")).toBeInTheDocument();
    expect(screen.getByText("ค่าใช้จ่ายตามประเภท (ทุกเดือน)")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีค่าใช้จ่ายในช่วงที่เลือก")).toBeInTheDocument();
    expect(screen.queryByText(/เดือนนี้/)).not.toBeInTheDocument();
    rerender(<ExpenseSummary summary={empty} allScope monthMode="selected" />);
    expect(screen.getByText("ใช้จ่ายเดือนที่เลือก")).toBeInTheDocument();
    expect(screen.queryByText(/เดือนนี้/)).not.toBeInTheDocument();
  });

  it("all scope swaps the pending label off (ของคุณ) and renders source subtotals", () => {
    render(
      <ExpenseSummary
        summary={base}
        allScope
        bySource={[
          { source: "company_card", total: 700 },
          { source: "own_money", total: 100 },
        ]}
      />,
    );
    expect(screen.getByText(EXPENSE_PENDING_TOTAL_ALL_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(EXPENSE_PENDING_TOTAL_LABEL)).not.toBeInTheDocument();
    expect(screen.getByText(PAYMENT_SOURCE_CARD_LABEL)).toBeInTheDocument();
    expect(screen.getByText(PAYMENT_SOURCE_OWN_LABEL)).toBeInTheDocument();
  });
});
