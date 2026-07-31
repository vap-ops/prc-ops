// Feedback 41cd07d9 — per-row edit/delete on the submitter's own expense list.
// The component OWNS the visibility rule (reimbursed row -> renders nothing:
// the lock is server-enforced; the affordance never offers what the RPC
// refuses — no affordance-then-refuse). Edit opens a prefilled sheet wired to
// updateOfficeExpense; delete is confirm-guarded onto deleteOfficeExpense.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateOfficeExpense = vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({ ok: true }),
);
const deleteOfficeExpense = vi.fn(async () => ({ ok: true }) as const);
vi.mock("@/app/expenses/actions", () => ({
  updateOfficeExpense: (...a: unknown[]) => updateOfficeExpense(...(a as [])),
  deleteOfficeExpense: (...a: unknown[]) => deleteOfficeExpense(...(a as [])),
}));
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

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
  routerRefresh.mockClear();
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: EXPENSE_UPDATE_SUBMIT }));
    });
    await waitFor(() => expect(updateOfficeExpense).toHaveBeenCalledTimes(1));
    // Full payload pin — objectContaining on a subset lets a dropped field
    // ship green (review finding); every field the RPC takes is asserted.
    expect(updateOfficeExpense).toHaveBeenCalledWith({
      expenseId: row.id,
      amount: 300,
      expenseDate: "2026-07-11",
      categoryId: row.categoryId,
      paymentSource: "own_money",
      description: "ค่าปริ้นแบบ",
      projectId: null,
      companyCardId: null,
    });
    // Success closes the sheet and refreshes the server data.
    expect(screen.queryByText(EXPENSE_EDIT_HEADING)).toBeNull();
    expect(routerRefresh).toHaveBeenCalled();
  });

  it("a failed save keeps the sheet open and shows the server's reason in place", async () => {
    updateOfficeExpense.mockResolvedValueOnce({ ok: false, error: "ไม่มีสิทธิ์แก้ไขรายการนี้" });
    render(
      <ExpenseRowActions row={row} categories={categories} projects={projects} cards={cards} />,
    );
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_EDIT_LABEL }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: EXPENSE_UPDATE_SUBMIT }));
    });
    expect(screen.getByText("ไม่มีสิทธิ์แก้ไขรายการนี้")).toBeTruthy();
    expect(screen.getByText(EXPENSE_EDIT_HEADING)).toBeTruthy();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("reopening after cancel re-seeds from the row (no abandoned edits)", async () => {
    render(
      <ExpenseRowActions row={row} categories={categories} projects={projects} cards={cards} />,
    );
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_EDIT_LABEL }));
    const amount = screen.getByLabelText(/จำนวนเงิน/) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_EDIT_LABEL }));
    expect((screen.getByLabelText(/จำนวนเงิน/) as HTMLInputElement).value).toBe("250");
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
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: EXPENSE_DELETE_LABEL }).at(-1)!);
    });
    await waitFor(() => expect(deleteOfficeExpense).toHaveBeenCalledWith(row.id));
  });
});
