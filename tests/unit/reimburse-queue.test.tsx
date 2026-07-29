// Spec 310 U5 — the reimburse queue renders one card per target person with the
// running total and a mark button per expense; empty state otherwise.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/app/expenses/actions", () => ({
  markExpenseReimbursed: vi.fn(async () => ({ ok: true }) as const),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ReimburseQueue } from "@/components/features/expenses/reimburse-queue";
import type { ReimbursableRow } from "@/lib/expenses/reimburse-group";
import { reviewStatusLabel } from "@/lib/accounting/review-queue-view";
import { REIMBURSE_MARK_LABEL, REIMBURSE_QUEUE_EMPTY } from "@/lib/i18n/labels";

const rows: ReimbursableRow[] = [
  {
    id: "1",
    reimburseToUserId: "u1",
    reimburseToName: "Pattrawut",
    amount: 100,
    categoryLabel: "น้ำมัน",
    expenseDate: "2026-07-12",
    description: "",
  },
  {
    id: "2",
    reimburseToUserId: "u1",
    reimburseToName: "Pattrawut",
    amount: 50,
    categoryLabel: "ทางด่วน",
    expenseDate: "2026-07-12",
    description: "",
  },
  {
    id: "3",
    reimburseToUserId: "u2",
    reimburseToName: "Acc",
    amount: 200,
    categoryLabel: "อื่นๆ",
    expenseDate: "2026-07-11",
    description: "",
  },
];

describe("ReimburseQueue", () => {
  it("renders a group per person with the total and a mark button per item", () => {
    render(<ReimburseQueue rows={rows} />);
    expect(screen.getByText("Pattrawut")).toBeTruthy();
    expect(screen.getByText("Acc")).toBeTruthy();
    // group totals (scoped to the รวม prefix so item amounts don't match)
    expect(screen.getByText(/รวม\D*150/)).toBeTruthy();
    expect(screen.getByText(/รวม\D*200/)).toBeTruthy();
    // one mark button per expense row (3)
    expect(screen.getAllByRole("button", { name: REIMBURSE_MARK_LABEL })).toHaveLength(3);
  });

  it("shows the empty state when nothing is awaiting reimbursement", () => {
    render(<ReimburseQueue rows={[]} />);
    expect(screen.getByText(REIMBURSE_QUEUE_EMPTY)).toBeTruthy();
  });

  // Spec 373 D5 — validate-before-pay: each row carries its review + doc state
  // and a door to the voucher, so คืนเงินแล้ว is never pressed blind. Soft
  // signal only — the mark button is NOT gated on review state.
  it("renders review-status and missing-doc chips + a voucher link per row when provided", () => {
    const withReview: ReimbursableRow[] = [
      { ...rows[0]!, reviewStatus: "pending", docCount: 0 },
      { ...rows[2]!, reviewStatus: "verified", docCount: 1 },
    ];
    render(<ReimburseQueue rows={withReview} fromHref="/expenses" />);
    expect(screen.getByText(reviewStatusLabel("pending"))).toBeTruthy();
    expect(screen.getByText(reviewStatusLabel("verified"))).toBeTruthy();
    expect(screen.getAllByText("ไม่มีเอกสาร")).toHaveLength(1);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href")).sort()).toEqual([
      `/accounting/review/office_expenses/1?from=${encodeURIComponent("/expenses")}`,
      `/accounting/review/office_expenses/3?from=${encodeURIComponent("/expenses")}`,
    ]);
    // The money action itself is NOT review-gated (hard gate = operator call).
    expect(screen.getAllByRole("button", { name: REIMBURSE_MARK_LABEL })).toHaveLength(2);
  });

  it("stays chip-free (and link-free) when review state is absent — no fake 'pending'", () => {
    render(<ReimburseQueue rows={rows} />);
    expect(screen.queryByText(reviewStatusLabel("pending"))).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
