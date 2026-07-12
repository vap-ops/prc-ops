// Spec 310 U3 — behavior coverage for the office-expense form: own_money records
// straight through; company_card requires a card + shows the holder as the
// reimburse-target; empty amount blocks.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordOfficeExpense = vi.fn(async (_i: unknown) => ({ ok: true, id: "e1" }) as const);
vi.mock("@/app/expenses/actions", () => ({
  recordOfficeExpense: (i: unknown) => recordOfficeExpense(i),
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
  EXPENSE_RECORDED_ATTACH,
  EXPENSE_SUBMIT_LABEL,
  PAYMENT_SOURCE_CARD_LABEL,
} from "@/lib/i18n/labels";

const CAT = "11111111-1111-1111-1111-111111111111";
const CARD = "22222222-2222-2222-2222-222222222222";
const PROJ = "33333333-3333-3333-3333-333333333333";
const categories: ExpenseCategory[] = [{ id: CAT, labelTh: "น้ำมัน" }];
const projects: ProjectOption[] = [{ id: PROJ, name: "โครงการ A", code: "PA" }];
const cards: CompanyCard[] = [
  {
    id: CARD,
    label: "PD Visa",
    holderUserId: "44444444-4444-4444-4444-444444444444",
    holderName: "Pattrawut",
    last4: "4821",
    isActive: true,
  },
];

beforeEach(() => {
  recordOfficeExpense.mockClear();
  refresh.mockClear();
});

describe("OfficeExpenseForm", () => {
  it("records an own_money expense with the entered fields (reimburse resolved server-side)", async () => {
    render(<OfficeExpenseForm categories={categories} projects={projects} cards={cards} />);
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
    // after recording, the receipt uploader block appears for the new expense (U4)
    await waitFor(() => expect(screen.getByText(EXPENSE_RECORDED_ATTACH)).toBeTruthy());
  });

  it("blocks a company_card expense with no card picked, then shows the holder + records it", async () => {
    render(<OfficeExpenseForm categories={categories} projects={projects} cards={cards} />);
    fireEvent.change(screen.getByLabelText(EXPENSE_CATEGORY_LABEL), { target: { value: CAT } });
    fireEvent.change(screen.getByLabelText(EXPENSE_AMOUNT_LABEL), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(EXPENSE_DESCRIPTION_LABEL), {
      target: { value: "น้ำมัน" },
    });
    // switch to company_card (a button), submit without a card → blocked
    fireEvent.click(screen.getByRole("button", { name: PAYMENT_SOURCE_CARD_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));
    expect(recordOfficeExpense).not.toHaveBeenCalled();

    // pick the card → holder shows as reimburse-target → records
    fireEvent.change(screen.getByLabelText("เลือกบัตร"), { target: { value: CARD } });
    // the reimburse hint (not the <option>) names the holder
    expect(screen.getByText(/คืนเงินให้.*Pattrawut/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));
    await waitFor(() =>
      expect(recordOfficeExpense).toHaveBeenCalledWith(
        expect.objectContaining({ paymentSource: "company_card", companyCardId: CARD }),
      ),
    );
  });

  it("blocks submit with an empty amount", () => {
    render(<OfficeExpenseForm categories={categories} projects={projects} cards={cards} />);
    fireEvent.change(screen.getByLabelText(EXPENSE_CATEGORY_LABEL), { target: { value: CAT } });
    fireEvent.change(screen.getByLabelText(EXPENSE_DESCRIPTION_LABEL), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: EXPENSE_SUBMIT_LABEL }));
    expect(recordOfficeExpense).not.toHaveBeenCalled();
  });
});
