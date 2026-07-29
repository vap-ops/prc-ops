// Spec 310 U3 — the submitter's own office expenses, newest first. Each row
// carries the reimburse-target, reimbursed, and awaiting-receipt states as chips.
// Spec 373 D2 — AllExpenseList: the finance all-scope variant. Adds the
// submitter, the spec-345 review-status chip + missing-doc chip, and links each
// row to its review voucher (the voucher owns verify/flag — no write path here).

import Link from "next/link";
import type { AllExpenseRow, OfficeExpenseRow } from "@/lib/expenses/load-office-expenses";
import { bahtWithSymbol } from "@/lib/format";
import { docsBadgeLabel, reviewStatusLabel } from "@/lib/accounting/review-queue-view";
import {
  EXPENSE_ALL_CAP_NOTE,
  EXPENSE_AWAITING_RECEIPT,
  EXPENSE_LIST_EMPTY,
  EXPENSE_REIMBURSE_TO_PREFIX,
  EXPENSE_REIMBURSED_BADGE,
  EXPENSE_SUBMITTER_PREFIX,
} from "@/lib/i18n/labels";

const CHIP = "rounded-control border px-2 py-0.5 text-xs font-medium";

export function ExpenseList({ expenses }: { expenses: OfficeExpenseRow[] }) {
  if (expenses.length === 0) {
    return <p className="text-ink-secondary text-sm">{EXPENSE_LIST_EMPTY}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {expenses.map((e) => (
        <li key={e.id} className="border-edge bg-card flex flex-col gap-1 rounded-xl border p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ink text-sm font-medium">{e.categoryLabel ?? "—"}</span>
            <span className="text-ink text-sm font-semibold">{bahtWithSymbol(e.amount)}</span>
          </div>
          <div className="text-ink-secondary flex flex-wrap items-center gap-x-2 text-xs">
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
                <span className={`${CHIP} border-edge text-ink-secondary`}>
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

// Review-status chip tones: verified reads done, flagged reads warn, pending
// stays neutral — same semantic family as the queue's own chips.
const REVIEW_CHIP_TONE: Record<AllExpenseRow["reviewStatus"], string> = {
  pending: "border-edge text-ink-secondary",
  flagged: "border-warn-edge bg-warn-soft text-ink",
  verified: "border-done-edge bg-done-soft text-done-ink",
};

export function AllExpenseList({
  expenses,
  fromHref,
  capped = false,
}: {
  expenses: AllExpenseRow[];
  fromHref: string;
  capped?: boolean;
}) {
  if (expenses.length === 0) {
    return <p className="text-ink-secondary text-sm">{EXPENSE_LIST_EMPTY}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {expenses.map((e) => {
          const docChip = docsBadgeLabel({ docsExpected: "expected", docCount: e.docCount });
          return (
            <li key={e.id}>
              <Link
                href={`/accounting/review/office_expenses/${e.id}?from=${encodeURIComponent(fromHref)}`}
                className="border-edge bg-card flex flex-col gap-1 rounded-xl border p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-ink text-sm font-medium">{e.categoryLabel ?? "—"}</span>
                  <span className="text-ink text-sm font-semibold">{bahtWithSymbol(e.amount)}</span>
                </div>
                <div className="text-ink-secondary flex flex-wrap items-center gap-x-2 text-xs">
                  <span>
                    {EXPENSE_SUBMITTER_PREFIX} {e.submitterName ?? "—"}
                  </span>
                  <span>· {e.expenseDate}</span>
                  {e.projectName && <span>· {e.projectName}</span>}
                  {e.description && <span>· {e.description}</span>}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <span className={`${CHIP} ${REVIEW_CHIP_TONE[e.reviewStatus]}`}>
                    {reviewStatusLabel(e.reviewStatus)}
                  </span>
                  {docChip && (
                    <span className={`${CHIP} border-wait-edge bg-wait-soft text-ink`}>
                      {docChip}
                    </span>
                  )}
                  {e.reimbursedAt ? (
                    <span className={`${CHIP} border-done-edge bg-done-soft text-done-ink`}>
                      {EXPENSE_REIMBURSED_BADGE}
                    </span>
                  ) : (
                    e.reimburseToName && (
                      <span className={`${CHIP} border-edge text-ink-secondary`}>
                        {EXPENSE_REIMBURSE_TO_PREFIX}: {e.reimburseToName}
                      </span>
                    )
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {capped && <p className="text-ink-secondary px-1 text-xs">{EXPENSE_ALL_CAP_NOTE}</p>}
    </div>
  );
}
