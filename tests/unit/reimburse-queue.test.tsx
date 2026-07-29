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
import {
  REIMBURSE_MARK_LABEL,
  REIMBURSE_NEEDS_REVIEW,
  REIMBURSE_QUEUE_EMPTY,
} from "@/lib/i18n/labels";

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
    // Spec 373 §5: the mark button now requires a verified review — this case
    // pins GROUPING + totals, so its fixtures are verified (the gate has its
    // own cases below).
    render(
      <ReimburseQueue rows={rows.map((r) => ({ ...r, reviewStatus: "verified" as const }))} />,
    );
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
  // and a door to the voucher. §5 hard gate (operator 2026-07-29): the mark
  // button itself is review-gated now — see the dedicated gate cases below.
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
    // Spec 373 §5 (operator 2026-07-29): the money action IS review-gated —
    // only the verified row keeps its button (supersedes the earlier soft rule).
    expect(screen.getAllByRole("button", { name: REIMBURSE_MARK_LABEL })).toHaveLength(1);
  });

  it("stays chip-free (and link-free) when review state is absent — no fake 'pending'", () => {
    render(<ReimburseQueue rows={rows} />);
    expect(screen.queryByText(reviewStatusLabel("pending"))).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  // Spec 373 §5 hard pay-gate (operator 2026-07-29): the money button renders
  // ONLY on a verified row. The unverified replacement carries the REASON and
  // the review chip stays the door to the voucher — a removal must re-home the
  // affordance, never just delete it.
  it("unverified rows lose the mark button and gain the reason; verified rows keep it", () => {
    const mixed: ReimbursableRow[] = [
      { ...rows[0]!, reviewStatus: "pending", docCount: 1 },
      { ...rows[1]!, reviewStatus: "flagged", docCount: 1 },
      { ...rows[2]!, reviewStatus: "verified", docCount: 1 },
    ];
    render(<ReimburseQueue rows={mixed} fromHref="/expenses" />);
    expect(screen.getAllByRole("button", { name: REIMBURSE_MARK_LABEL })).toHaveLength(1);
    expect(screen.getAllByText(REIMBURSE_NEEDS_REVIEW)).toHaveLength(2);
    // The doors survive: every row still links to its voucher.
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("absent review state closes the gate too (absent = unverified, never a free pass)", () => {
    render(<ReimburseQueue rows={[rows[0]!]} />);
    expect(screen.queryByRole("button", { name: REIMBURSE_MARK_LABEL })).toBeNull();
    expect(screen.getByText(REIMBURSE_NEEDS_REVIEW)).toBeInTheDocument();
  });
});
