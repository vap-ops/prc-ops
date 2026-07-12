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
});
