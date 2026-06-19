// Spec 149 U9 / ADR 0057 — pure shaping of gl_trial_balance rows for the
// /accounting dashboard. Groups by account class, totals debits/credits (a healthy
// ledger balances), and derives a P&L: income is credit-normal (credit − debit),
// expense is debit-normal (debit − credit), net profit = income − expense.

export const GL_CLASSES = ["asset", "liability", "equity", "income", "expense"] as const;
export type GlClass = (typeof GL_CLASSES)[number];

export interface TrialBalanceRow {
  accountType: string;
  debitTotal: number;
  creditTotal: number;
}

export interface GroupedTrialBalance<R extends TrialBalanceRow> {
  sections: Record<GlClass, R[]>;
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export function groupTrialBalance<R extends TrialBalanceRow>(rows: R[]): GroupedTrialBalance<R> {
  const sections = {
    asset: [],
    liability: [],
    equity: [],
    income: [],
    expense: [],
  } as Record<GlClass, R[]>;

  let totalDebit = 0;
  let totalCredit = 0;

  for (const row of rows) {
    if ((GL_CLASSES as readonly string[]).includes(row.accountType)) {
      sections[row.accountType as GlClass].push(row);
    }
    totalDebit += row.debitTotal;
    totalCredit += row.creditTotal;
  }

  return {
    sections,
    totalDebit,
    totalCredit,
    // Compare in integer cents to avoid float drift.
    balanced: Math.round(totalDebit * 100) === Math.round(totalCredit * 100),
  };
}

export interface ProfitAndLoss {
  income: number;
  expense: number;
  netProfit: number;
}

export function profitAndLoss(rows: TrialBalanceRow[]): ProfitAndLoss {
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (row.accountType === "income") income += row.creditTotal - row.debitTotal;
    else if (row.accountType === "expense") expense += row.debitTotal - row.creditTotal;
  }
  return { income, expense, netProfit: income - expense };
}
