// Spec 310 U3/U10 — behavior coverage for the office-expense form: own_money
// records straight through and closes the sheet (onDone); company_card auto-uses
// the holder's card; a blank รายละเอียด falls back to the category label; a held
// attachment uploads on submit; empty amount blocks.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordOfficeExpense = vi.fn(async (_i: unknown) => ({ ok: true, id: "e1" }) as const);
vi.mock("@/app/expenses/actions", () => ({
  recordOfficeExpense: (i: unknown) => recordOfficeExpense(i),
}));
const uploadExpenseReceiptFile = vi.fn(async () => ({ ok: true }) as const);
vi.mock("@/lib/expenses/upload-expense-receipt", () => ({
  uploadExpenseReceiptFile: (...a: unknown[]) => uploadExpenseReceiptFile(...(a as [])),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { OfficeExpenseForm } from "@/components/features/expenses/office-expense-form";
import type {
  CompanyCard,
  ExpenseCategory,
  ProjectOption,
} from "@/lib/expenses/load-office-expenses";
import {
  EXPENSE_AMOUNT_LABEL,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_DESCRIPTION_LABEL,
  EXPENSE_SUBMIT_LABEL,
  PAYMENT_SOURCE_CARD_LABEL,
} from "@/lib/i18n/labels";

const CAT = "11111111-1111-1111-1111-111111111111";
const CARD = "22222222-2222-2222-2222-222222222222";
const PROJ = "33333333-3333-3333-3333-333333333333";
const categories: ExpenseCategory[] = [{ id: CAT, labelTh: "น้ำมัน" }];
const projects: ProjectOption[] = [{ id: PROJ, name: "โครงการ A", code: "PA" }];
const myCard: CompanyCard = {
  id: CARD,
  label: "PD Visa",
  holderUserId: "44444444-4444-4444-4444-444444444444",
  holderName: "Pattrawut",
  last4: "4821",
  isActive: true,
};

beforeEach(() => {
  recordOfficeExpense.mockClear();
  uploadExpenseReceiptFile.mockClear();
  refresh.mockClear();
});

describe("OfficeExpenseForm", () => {
  it("records an own_money expense and closes the sheet (onDone) on a clean save", async () => {
    const onDone = vi.fn();
    render(
      <OfficeExpenseForm
        categories={categories}
        projects={projects}
        myCard={myCard}
        onDone={onDone}
      />,
    );
    fireEvent.change(screen.getByLabelText(EXPENSE_CATEGORY_LABEL), { target: { value: CAT } });
    fireEvent.change(screen.getByLabelText(EXPENSE_AMOUNT_LABEL), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText(EXPENSE_DESCRIPTION_LABEL), {
      target: { value: "พิมพ์เอกสาร" },
    });
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));

    await waitFor(() =>
      expect(recordOfficeExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: CAT,
          amount: 250,
          description: "พิมพ์เอกสาร",
          paymentSource: "own_money",
          projectId: null,
          companyCardId: null,
        }),
      ),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("falls back to the category label when รายละเอียด is left blank", async () => {
    render(
      <OfficeExpenseForm
        categories={categories}
        projects={projects}
        myCard={myCard}
        onDone={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(EXPENSE_CATEGORY_LABEL), { target: { value: CAT } });
    fireEvent.change(screen.getByLabelText(EXPENSE_AMOUNT_LABEL), { target: { value: "100" } });
    // description left empty
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));

    await waitFor(() =>
      expect(recordOfficeExpense).toHaveBeenCalledWith(
        expect.objectContaining({ description: "น้ำมัน" }),
      ),
    );
  });

  it("uploads a held slip attachment on submit", async () => {
    const { container } = render(
      <OfficeExpenseForm
        categories={categories}
        projects={projects}
        myCard={myCard}
        onDone={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(EXPENSE_CATEGORY_LABEL), { target: { value: CAT } });
    fireEvent.change(screen.getByLabelText(EXPENSE_AMOUNT_LABEL), { target: { value: "300" } });
    // pick a slip into the first (slip) held-file input
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "slip.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));

    await waitFor(() =>
      expect(uploadExpenseReceiptFile).toHaveBeenCalledWith("e1", expect.any(File), "payment_slip"),
    );
  });

  it("company_card auto-uses the holder's one card (no picker) and reimburses the holder", async () => {
    render(
      <OfficeExpenseForm
        categories={categories}
        projects={projects}
        myCard={myCard}
        onDone={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(EXPENSE_CATEGORY_LABEL), { target: { value: CAT } });
    fireEvent.change(screen.getByLabelText(EXPENSE_AMOUNT_LABEL), { target: { value: "500" } });
    // pick the company-card source (a button) — no picker; the holder shows as the target
    fireEvent.click(screen.getByRole("button", { name: PAYMENT_SOURCE_CARD_LABEL }));
    expect(screen.getByText(/คืนเงินให้.*Pattrawut/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));
    await waitFor(() =>
      expect(recordOfficeExpense).toHaveBeenCalledWith(
        expect.objectContaining({ paymentSource: "company_card", companyCardId: CARD }),
      ),
    );
  });

  it("hides the company-card source when the user holds no card", () => {
    render(
      <OfficeExpenseForm
        categories={categories}
        projects={projects}
        myCard={null}
        onDone={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: PAYMENT_SOURCE_CARD_LABEL })).toBeNull();
  });

  it("blocks submit with an empty amount", () => {
    render(
      <OfficeExpenseForm
        categories={categories}
        projects={projects}
        myCard={myCard}
        onDone={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(EXPENSE_CATEGORY_LABEL), { target: { value: CAT } });
    fireEvent.change(screen.getByLabelText(EXPENSE_DESCRIPTION_LABEL), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));
    expect(recordOfficeExpense).not.toHaveBeenCalled();
  });
});
