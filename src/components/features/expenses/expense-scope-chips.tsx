// Spec 373 D1 — the finance-only scope chips atop /expenses. Server-safe links
// (no client state): each chip re-navigates with the scope param while keeping
// the project lens, the month filter and the referrer intact. The page renders
// this ONLY for OFFICE_EXPENSE_FINANCE_ROLES — a non-finance user never sees
// the chips, and the resolver ignores their crafted ?scope=all anyway.

import Link from "next/link";
import type { ExpenseScope } from "@/lib/expenses/expense-scope";
import {
  EXPENSE_SCOPE_ALL_LABEL,
  EXPENSE_SCOPE_ARIA,
  EXPENSE_SCOPE_OWN_LABEL,
} from "@/lib/i18n/labels";

export function ExpenseScopeChips({
  scope,
  hrefFor,
}: {
  scope: ExpenseScope;
  hrefFor: (scope: ExpenseScope) => string;
}) {
  const chips: { key: ExpenseScope; label: string }[] = [
    { key: "own", label: EXPENSE_SCOPE_OWN_LABEL },
    { key: "all", label: EXPENSE_SCOPE_ALL_LABEL },
  ];
  return (
    <nav aria-label={EXPENSE_SCOPE_ARIA} className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={hrefFor(c.key)}
          aria-current={c.key === scope ? "page" : undefined}
          className={
            c.key === scope
              ? "bg-action text-on-fill rounded-full px-3 py-1.5 text-sm font-medium"
              : "border-edge text-ink-secondary rounded-full border px-3 py-1.5 text-sm"
          }
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
