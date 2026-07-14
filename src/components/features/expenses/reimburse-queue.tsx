"use client";

// Spec 310 U5 — the finance reimburse queue. Expenses awaiting reimbursement,
// grouped by the person they're owed to, each with a running total; a per-row
// "คืนเงินแล้ว" marks it settled (confirm-guarded — it's a money action). Only
// rendered for OFFICE_EXPENSE_FINANCE_ROLES (the page gates it).

import { markExpenseReimbursed } from "@/app/expenses/actions";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { bahtWithSymbol } from "@/lib/format";
import { groupByReimburseTarget, type ReimbursableRow } from "@/lib/expenses/reimburse-group";
import {
  REIMBURSE_MARK_CONFIRM,
  REIMBURSE_MARK_LABEL,
  REIMBURSE_MARK_PENDING,
  REIMBURSE_QUEUE_EMPTY,
  REIMBURSE_QUEUE_HEADING,
  REIMBURSE_TOTAL_PREFIX,
} from "@/lib/i18n/labels";

export function ReimburseQueue({ rows }: { rows: ReimbursableRow[] }) {
  const groups = groupByReimburseTarget(rows);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-ink-secondary px-1 text-xs font-semibold tracking-wide uppercase">
        {REIMBURSE_QUEUE_HEADING}
      </h2>
      {groups.length === 0 ? (
        <p className="text-ink-secondary text-sm">{REIMBURSE_QUEUE_EMPTY}</p>
      ) : (
        groups.map((g) => (
          <div
            key={g.userId}
            className="border-edge bg-card flex flex-col gap-2 rounded-xl border p-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink text-sm font-semibold">{g.name ?? "—"}</span>
              <span className="text-ink text-sm font-semibold">
                {REIMBURSE_TOTAL_PREFIX} {bahtWithSymbol(g.total)}
              </span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {g.items.map((it) => (
                <li
                  key={it.id}
                  className="border-edge flex items-center justify-between gap-3 rounded-lg border p-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-ink truncate text-sm">
                      {it.categoryLabel ?? "—"} · {bahtWithSymbol(it.amount)}
                    </span>
                    <span className="text-ink-secondary truncate text-xs">
                      {it.expenseDate}
                      {it.description ? ` · ${it.description}` : ""}
                    </span>
                  </div>
                  <ConfirmActionButton
                    idleLabel={REIMBURSE_MARK_LABEL}
                    pendingLabel={REIMBURSE_MARK_PENDING}
                    confirmMessage={REIMBURSE_MARK_CONFIRM}
                    confirmLabel={REIMBURSE_MARK_LABEL}
                    buttonClassName="border-edge text-ink rounded-control shrink-0 border px-3 py-1.5 text-xs font-medium"
                    action={() => markExpenseReimbursed(it.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
