import { describe, it, expect } from "vitest";
import { validateOfficeExpense } from "@/lib/expenses/validate-office-expense";

const base = {
  categoryId: "11111111-1111-1111-1111-111111111111",
  description: "น้ำมัน",
  amount: 500,
  expenseDate: "2026-07-12",
  paymentSource: "own_money" as const,
  projectId: null,
  companyCardId: null,
};

describe("validateOfficeExpense", () => {
  it("accepts a valid own_money expense", () => {
    const r = validateOfficeExpense(base);
    expect(r.ok).toBe(true);
  });

  it("trims the description in the returned value", () => {
    const r = validateOfficeExpense({ ...base, description: "  น้ำมัน  " });
    expect(r.ok && r.value.description).toBe("น้ำมัน");
  });

  it("rejects non-positive amount", () => {
    expect(validateOfficeExpense({ ...base, amount: 0 }).ok).toBe(false);
    expect(validateOfficeExpense({ ...base, amount: -5 }).ok).toBe(false);
  });

  it("rejects empty description", () => {
    expect(validateOfficeExpense({ ...base, description: "   " }).ok).toBe(false);
  });

  it("requires a card for the company_card source", () => {
    expect(
      validateOfficeExpense({ ...base, paymentSource: "company_card", companyCardId: null }).ok,
    ).toBe(false);
  });

  it("accepts company_card with a card", () => {
    expect(
      validateOfficeExpense({
        ...base,
        paymentSource: "company_card",
        companyCardId: "22222222-2222-2222-2222-222222222222",
      }).ok,
    ).toBe(true);
  });

  it("rejects a card supplied on a non-card source", () => {
    expect(
      validateOfficeExpense({
        ...base,
        paymentSource: "own_money",
        companyCardId: "22222222-2222-2222-2222-222222222222",
      }).ok,
    ).toBe(false);
  });

  it("rejects a bad expense date", () => {
    expect(validateOfficeExpense({ ...base, expenseDate: "2026-7-1" }).ok).toBe(false);
  });

  it("rejects an invalid project id but accepts null", () => {
    expect(validateOfficeExpense({ ...base, projectId: "not-a-uuid" }).ok).toBe(false);
    expect(validateOfficeExpense({ ...base, projectId: null }).ok).toBe(true);
  });
});
