// Spec 310 U7 — the personal expense dashboard shown atop /expenses: two stat
// tiles (this month's spend + your pending reimbursement) and a by-category bar
// chart for the month. Display-only (server-safe). dataviz: single-series
// magnitude → horizontal bars sorted big→small, one accent hue, each bar's value
// direct-labeled in ink (no legend, no hover needed — values are on the marks).

import type { MyExpenseSummary } from "@/lib/expenses/load-office-expenses";
import { bahtWithSymbol } from "@/lib/format";
import {
  EXPENSE_CHART_HEADING,
  EXPENSE_MONTH_EMPTY,
  EXPENSE_MONTH_TOTAL_LABEL,
  EXPENSE_PENDING_TOTAL_LABEL,
} from "@/lib/i18n/labels";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-edge bg-card flex flex-col gap-1 rounded-xl border p-4">
      <span className="text-ink-secondary text-xs font-medium">{label}</span>
      <span className="text-ink text-lg font-semibold">{value}</span>
    </div>
  );
}

export function ExpenseSummary({ summary }: { summary: MyExpenseSummary }) {
  const max = Math.max(1, ...summary.byCategory.map((c) => c.total));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={EXPENSE_MONTH_TOTAL_LABEL} value={bahtWithSymbol(summary.monthTotal)} />
        <StatTile
          label={EXPENSE_PENDING_TOTAL_LABEL}
          value={bahtWithSymbol(summary.pendingReimburse)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-ink-secondary px-1 text-xs font-semibold tracking-wide uppercase">
          {EXPENSE_CHART_HEADING}
        </h2>
        {summary.byCategory.length === 0 ? (
          <p className="text-ink-secondary text-sm">{EXPENSE_MONTH_EMPTY}</p>
        ) : (
          <ul className="border-edge bg-card flex flex-col gap-2.5 rounded-xl border p-4">
            {summary.byCategory.map((c) => (
              <li key={c.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink truncate font-medium">{c.label}</span>
                  <span className="text-ink shrink-0 font-semibold tabular-nums">
                    {bahtWithSymbol(c.total)}
                  </span>
                </div>
                <div className="bg-muted h-2 w-full overflow-hidden rounded-full" aria-hidden>
                  <div
                    className="bg-action h-full rounded-full"
                    style={{ width: `${Math.max(4, (c.total / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
