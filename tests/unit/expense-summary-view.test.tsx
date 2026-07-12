// Spec 310 U7 — the personal dashboard renders the stat tiles + a bar per
// category, and an empty state when there's no spend this month.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ExpenseSummary } from "@/components/features/expenses/expense-summary";
import type { MyExpenseSummary } from "@/lib/expenses/load-office-expenses";
import {
  EXPENSE_MONTH_EMPTY,
  EXPENSE_MONTH_TOTAL_LABEL,
  EXPENSE_PENDING_TOTAL_LABEL,
} from "@/lib/i18n/labels";

const summary: MyExpenseSummary = {
  monthLabel: "2026-07",
  monthTotal: 1500,
  pendingReimburse: 500,
  byCategory: [
    { label: "น้ำมัน", total: 1000 },
    { label: "ทางด่วน", total: 500 },
  ],
};

describe("ExpenseSummary", () => {
  it("renders both stat tiles and a row per category", () => {
    render(<ExpenseSummary summary={summary} />);
    expect(screen.getByText(EXPENSE_MONTH_TOTAL_LABEL)).toBeTruthy();
    expect(screen.getByText(EXPENSE_PENDING_TOTAL_LABEL)).toBeTruthy();
    expect(screen.getByText("น้ำมัน")).toBeTruthy();
    expect(screen.getByText("ทางด่วน")).toBeTruthy();
  });

  it("shows the empty state when there's no spend this month", () => {
    render(
      <ExpenseSummary
        summary={{ monthLabel: "2026-07", monthTotal: 0, pendingReimburse: 0, byCategory: [] }}
      />,
    );
    expect(screen.getByText(EXPENSE_MONTH_EMPTY)).toBeTruthy();
  });
});
