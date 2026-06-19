// Spec 149 U9 §Tests (TDD, RED first) — pure shaping of gl_trial_balance rows for
// the /accounting dashboard: group by account class, total debits/credits (must
// balance), and derive a P&L (income credit-normal − expense debit-normal).

import { describe, it, expect } from "vitest";
import { groupTrialBalance, profitAndLoss } from "@/lib/accounting/trial-balance-view";

// A balanced fixture (147000 = 147000): the billing entry + a COGS accrual.
const rows = [
  { accountType: "asset", debitTotal: 99000, creditTotal: 0 }, // AR
  { accountType: "asset", debitTotal: 5000, creditTotal: 0 }, // retention
  { accountType: "asset", debitTotal: 3000, creditTotal: 0 }, // WHT prepaid
  { accountType: "income", debitTotal: 0, creditTotal: 100000 }, // revenue
  { accountType: "liability", debitTotal: 0, creditTotal: 7000 }, // output VAT
  { accountType: "expense", debitTotal: 40000, creditTotal: 0 }, // COGS
  { accountType: "liability", debitTotal: 0, creditTotal: 40000 }, // AP (offsets COGS)
];

describe("groupTrialBalance", () => {
  it("groups rows by account class", () => {
    const g = groupTrialBalance(rows);
    expect(g.sections.asset).toHaveLength(3);
    expect(g.sections.income).toHaveLength(1);
    expect(g.sections.liability).toHaveLength(2);
    expect(g.sections.expense).toHaveLength(1);
    expect(g.sections.equity).toHaveLength(0);
  });

  it("totals debits and credits", () => {
    const g = groupTrialBalance(rows);
    expect(g.totalDebit).toBe(147000);
    expect(g.totalCredit).toBe(147000);
  });

  it("reports balanced when debits equal credits", () => {
    expect(groupTrialBalance(rows).balanced).toBe(true);
  });

  it("reports unbalanced when they differ", () => {
    const g = groupTrialBalance([
      { accountType: "asset", debitTotal: 100, creditTotal: 0 },
      { accountType: "income", debitTotal: 0, creditTotal: 90 },
    ]);
    expect(g.balanced).toBe(false);
  });

  it("handles an empty ledger", () => {
    const g = groupTrialBalance([]);
    expect(g.totalDebit).toBe(0);
    expect(g.totalCredit).toBe(0);
    expect(g.balanced).toBe(true);
  });
});

describe("profitAndLoss", () => {
  it("derives income, expense, and net profit", () => {
    const pl = profitAndLoss(rows);
    expect(pl.income).toBe(100000); // credit-normal
    expect(pl.expense).toBe(40000); // debit-normal
    expect(pl.netProfit).toBe(60000);
  });

  it("nets a contra movement (debit on an income account reduces income)", () => {
    const pl = profitAndLoss([
      { accountType: "income", debitTotal: 0, creditTotal: 100000 },
      { accountType: "income", debitTotal: 10000, creditTotal: 0 },
    ]);
    expect(pl.income).toBe(90000);
    expect(pl.netProfit).toBe(90000);
  });
});
