// Spec 373 D2 — the all-scope expense list rows: submitter, receipt + review
// chips, and the voucher door. RTL over the real component (it is a sync
// server-safe component). The voucher link carries ?from= so the back chip
// returns here (D6).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AllExpenseList } from "@/components/features/expenses/expense-list";
import type { AllExpenseRow } from "@/lib/expenses/load-office-expenses";
import { reviewStatusLabel } from "@/lib/accounting/review-queue-view";

function row(overrides: Partial<AllExpenseRow>): AllExpenseRow {
  return {
    id: "e1",
    description: "น้ำมัน",
    amount: 500,
    expenseDate: "2026-07-01",
    paymentSource: "company_card",
    categoryLabel: "เดินทาง",
    projectName: null,
    cardLabel: null,
    reimburseToName: null,
    reimbursedAt: null,
    submitterId: "u1",
    submitterName: "สมชาย ทดสอบ",
    docCount: 1,
    reviewStatus: "pending",
    docsExpected: "expected",
    ...overrides,
  };
}

describe("spec 373 D2 — AllExpenseList", () => {
  it("shows the submitter on every row", () => {
    render(<AllExpenseList expenses={[row({})]} fromHref="/expenses?scope=all" />);
    expect(screen.getByText(/สมชาย ทดสอบ/)).toBeInTheDocument();
  });

  it("links each row to its review voucher, threading ?from=", () => {
    render(<AllExpenseList expenses={[row({})]} fromHref="/expenses?scope=all" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      `/accounting/review/office_expenses/e1?from=${encodeURIComponent("/expenses?scope=all")}`,
    );
  });

  it("a doc-less row gets the missing-doc chip; a documented row does not", () => {
    render(
      <AllExpenseList
        expenses={[row({ id: "no-doc", docCount: 0 }), row({ id: "has-doc", docCount: 1 })]}
        fromHref="/expenses?scope=all"
      />,
    );
    expect(screen.getAllByText("ไม่มีเอกสาร")).toHaveLength(1);
  });

  it("review status renders with the spec-345 labels — pending, flagged, verified", () => {
    render(
      <AllExpenseList
        expenses={[
          row({ id: "p", reviewStatus: "pending" }),
          row({ id: "f", reviewStatus: "flagged" }),
          row({ id: "v", reviewStatus: "verified" }),
        ]}
        fromHref="/expenses?scope=all"
      />,
    );
    expect(screen.getByText(reviewStatusLabel("pending"))).toBeInTheDocument();
    expect(screen.getByText(reviewStatusLabel("flagged"))).toBeInTheDocument();
    expect(screen.getByText(reviewStatusLabel("verified"))).toBeInTheDocument();
  });

  it("the cap note renders only when the cap bites", () => {
    const { rerender } = render(
      <AllExpenseList expenses={[row({})]} fromHref="/expenses?scope=all" capped={false} />,
    );
    expect(screen.queryByText("แสดง 100 รายการล่าสุด")).not.toBeInTheDocument();
    rerender(<AllExpenseList expenses={[row({})]} fromHref="/expenses?scope=all" capped />);
    expect(screen.getByText("แสดง 100 รายการล่าสุด")).toBeInTheDocument();
  });
});
