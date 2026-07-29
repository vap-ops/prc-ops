"use client";

// Spec 310 U5 — the finance reimburse queue. Expenses awaiting reimbursement,
// grouped by the person they're owed to, each with a running total; a per-row
// "คืนเงินแล้ว" marks it settled (confirm-guarded — it's a money action). Only
// rendered for OFFICE_EXPENSE_FINANCE_ROLES (the page gates it).
// Spec 373 D5 — validate-before-pay: rows carry their spec-345 review status +
// doc chip and link to the voucher. Soft signal only — the mark button is
// deliberately NOT gated on review state (hard gate = operator call, spec §5).

import Link from "next/link";
import { markExpenseReimbursed } from "@/app/expenses/actions";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { bahtWithSymbol } from "@/lib/format";
import { docsBadgeLabel, reviewStatusLabel } from "@/lib/accounting/review-queue-view";
import { groupByReimburseTarget, type ReimbursableRow } from "@/lib/expenses/reimburse-group";
import {
  REIMBURSE_MARK_CONFIRM,
  REIMBURSE_MARK_LABEL,
  REIMBURSE_MARK_PENDING,
  REIMBURSE_QUEUE_EMPTY,
  REIMBURSE_QUEUE_HEADING,
  REIMBURSE_TOTAL_PREFIX,
} from "@/lib/i18n/labels";

const CHIP = "rounded-control border px-2 py-0.5 text-xs font-medium";

const REVIEW_CHIP_TONE: Record<NonNullable<ReimbursableRow["reviewStatus"]>, string> = {
  pending: "border-edge text-ink-secondary",
  flagged: "border-warn-edge bg-warn-soft text-ink",
  verified: "border-done-edge bg-done-soft text-done-ink",
};

export function ReimburseQueue({ rows, fromHref }: { rows: ReimbursableRow[]; fromHref?: string }) {
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
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-ink truncate text-sm">
                      {it.categoryLabel ?? "—"} · {bahtWithSymbol(it.amount)}
                    </span>
                    <span className="text-ink-secondary truncate text-xs">
                      {it.expenseDate}
                      {it.description ? ` · ${it.description}` : ""}
                    </span>
                    {it.reviewStatus && (
                      <span className="flex flex-wrap gap-1.5 pt-0.5">
                        {fromHref ? (
                          <Link
                            href={`/accounting/review/office_expenses/${it.id}?from=${encodeURIComponent(fromHref)}`}
                            className={`${CHIP} ${REVIEW_CHIP_TONE[it.reviewStatus]} underline-offset-2`}
                          >
                            {reviewStatusLabel(it.reviewStatus)}
                          </Link>
                        ) : (
                          <span className={`${CHIP} ${REVIEW_CHIP_TONE[it.reviewStatus]}`}>
                            {reviewStatusLabel(it.reviewStatus)}
                          </span>
                        )}
                        {(() => {
                          const docChip = docsBadgeLabel({
                            docsExpected: "expected",
                            docCount: it.docCount ?? 0,
                          });
                          return docChip ? (
                            <span className={`${CHIP} border-wait-edge bg-wait-soft text-ink`}>
                              {docChip}
                            </span>
                          ) : null;
                        })()}
                      </span>
                    )}
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
