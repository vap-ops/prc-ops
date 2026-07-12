// Spec 310 U3 — the submitter's own office expenses, newest first. Each row
// carries the reimburse-target, reimbursed, and awaiting-receipt states as chips.

import type { OfficeExpenseRow } from "@/lib/expenses/load-office-expenses";
import { bahtWithSymbol } from "@/lib/format";
import {
  EXPENSE_AWAITING_RECEIPT,
  EXPENSE_LIST_EMPTY,
  EXPENSE_REIMBURSE_TO_PREFIX,
  EXPENSE_REIMBURSED_BADGE,
} from "@/lib/i18n/labels";

const CHIP = "rounded-control border px-2 py-0.5 text-xs font-medium";

export function ExpenseList({ expenses }: { expenses: OfficeExpenseRow[] }) {
  if (expenses.length === 0) {
    return <p className="text-ink-soft text-sm">{EXPENSE_LIST_EMPTY}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {expenses.map((e) => (
        <li key={e.id} className="border-edge bg-card flex flex-col gap-1 rounded-xl border p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ink text-sm font-medium">{e.categoryLabel ?? "—"}</span>
            <span className="text-ink text-sm font-semibold">{bahtWithSymbol(e.amount)}</span>
          </div>
          <div className="text-ink-soft flex flex-wrap items-center gap-x-2 text-xs">
            <span>{e.expenseDate}</span>
            {e.projectName && <span>· {e.projectName}</span>}
            {e.description && <span>· {e.description}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {e.reimbursedAt ? (
              <span className={`${CHIP} border-done-edge bg-done-soft text-done-ink`}>
                {EXPENSE_REIMBURSED_BADGE}
              </span>
            ) : (
              e.reimburseToName && (
                <span className={`${CHIP} border-edge text-ink-soft`}>
                  {EXPENSE_REIMBURSE_TO_PREFIX}: {e.reimburseToName}
                </span>
              )
            )}
            {e.awaitingReceipt && (
              <span className={`${CHIP} border-wait-edge bg-wait-soft text-ink`}>
                {EXPENSE_AWAITING_RECEIPT}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
