// Feedback 41cd07d9 — per-row edit/delete on the submitter's own expense list.
// The component OWNS the visibility rule (reimbursed row -> renders nothing:
// the lock is server-enforced; the affordance never offers what the RPC
// refuses — no affordance-then-refuse). Edit opens a prefilled sheet wired to
// updateOfficeExpense; delete is confirm-guarded onto deleteOfficeExpense.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateOfficeExpense = vi.fn(async () => ({ ok: true }) as const);
const deleteOfficeExpense = vi.fn(async () => ({ ok: true }) as const);
vi.mock("@/app/expenses/actions", () => ({
  updateOfficeExpense: (...a: unknown[]) => updateOfficeExpense(...(a as [])),
  deleteOfficeExpense: (...a: unknown[]) => deleteOfficeExpense(...(a as [])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ExpenseRowActions } from "@/components/features/expenses/expense-row-actions";
import type { OfficeExpenseRow } from "@/lib/expenses/load-office-expenses";
import {
  EXPENSE_DELETE_CONFIRM,
  EXPENSE_DELETE_LABEL,
  EXPENSE_EDIT_HEADING,
  EXPENSE_EDIT_LABEL,
  EXPENSE_UPDATE_SUBMIT,
} from "@/lib/i18n/labels";

const row: OfficeExpenseRow = {
  id: "3d000000-0000-4000-8000-000000000001",
  description: "ค่าปริ้นแบบ",
  amount: 250,
  expenseDate: "2026-07-10",
  paymentSource: "own_money",
  categoryLabel: "เอกสาร",
  projectName: null,
  cardLabel: null,
  reimburseToName: "PD",
  reimbursedAt: null,
  awaitingReceipt: false,
  categoryId: "c1000000-0000-4000-8000-000000000001",
  projectId: null,
  companyCardId: null,
};

const categories = [
  { id: "c1000000-0000-4000-8000-000000000001", label: "เอกสาร" },
  { id: "c2000000-0000-4000-8000-000000000002", label: "น้ำมัน" },
];
const projects = [{ id: "b1000000-0000-4000-8000-000000000001", name: "โครงการทดสอบ" }];
const cards: { id: string; label: string; holderName: string | null }[] = [];

beforeEach(() => {
  updateOfficeExpense.mockClear();
  deleteOfficeExpense.mockClear();
});

describe("ExpenseRowActions", () => {
  it("renders the edit affordance for an un-reimbursed row", () => {
    render(
      <ExpenseRowActions row={row} categories={categories} projects={projects} cards={cards} />,
    );
    expect(screen.getByRole("button", { name: EXPENSE_EDIT_LABEL })).toBeTruthy();
  });

  it("renders NOTHING for a reimbursed row (server lock mirrored — no offer-then-refuse)", () => {
    const { container } = render(
      <ExpenseRowActions
        row={{ ...row, reimbursedAt: "2026-07-20T00:00:00Z" }}
        categories={categories}
        projects={projects}
        cards={cards}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens the sheet prefilled and submits the changed fields to updateOfficeExpense", async () => {
    render(
      <ExpenseRowActions row={row} categories={categories} projects={projects} cards={cards} />,
    );
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_EDIT_LABEL }));
    expect(screen.getByText(EXPENSE_EDIT_HEADING)).toBeTruthy();

    const amount = screen.getByLabelText(/จำนวนเงิน/) as HTMLInputElement;
    expect(amount.value).toBe("250");
    fireEvent.change(amount, { target: { value: "300" } });

    const date = screen.getByLabelText(/วันที่/) as HTMLInputElement;
    expect(date.value).toBe("2026-07-10");
    fireEvent.change(date, { target: { value: "2026-07-11" } });

    fireEvent.click(screen.getByRole("button", { name: EXPENSE_UPDATE_SUBMIT }));
    await waitFor(() => expect(updateOfficeExpense).toHaveBeenCalledTimes(1));
    expect(updateOfficeExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        expenseId: row.id,
        amount: 300,
        expenseDate: "2026-07-11",
        categoryId: row.categoryId,
        paymentSource: "own_money",
      }),
    );
  });

  it("delete is confirm-guarded and calls deleteOfficeExpense with the row id", async () => {
    render(
      <ExpenseRowActions row={row} categories={categories} projects={projects} cards={cards} />,
    );
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_EDIT_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_DELETE_LABEL }));
    // The confirm step surfaces the warning copy; nothing deleted yet.
    expect(screen.getByText(EXPENSE_DELETE_CONFIRM)).toBeTruthy();
    expect(deleteOfficeExpense).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: EXPENSE_DELETE_LABEL }).at(-1)!);
    await waitFor(() => expect(deleteOfficeExpense).toHaveBeenCalledWith(row.id));
  });
});
