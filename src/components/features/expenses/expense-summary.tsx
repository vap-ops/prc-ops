// Spec 310 U7 — the personal expense dashboard shown atop /expenses: two stat
// tiles (this month's spend + your pending reimbursement) and a by-category bar
// chart for the month. Display-only (server-safe). dataviz: single-series
// magnitude → horizontal bars sorted big→small, one accent hue, each bar's value
// direct-labeled in ink (no legend, no hover needed — values are on the marks).

import type { MyExpenseSummary } from "@/lib/expenses/load-office-expenses";
import type { SourceSpend } from "@/lib/expenses/expense-summary";
import { bahtWithSymbol } from "@/lib/format";
import {
  EXPENSE_CHART_HEADING,
  EXPENSE_MONTH_EMPTY,
  EXPENSE_MONTH_TOTAL_LABEL,
  EXPENSE_PAYMENT_SOURCE_LABEL,
  EXPENSE_PENDING_TOTAL_ALL_LABEL,
  EXPENSE_PENDING_TOTAL_LABEL,
  PAYMENT_SOURCE_CARD_LABEL,
  PAYMENT_SOURCE_DIRECT_LABEL,
  PAYMENT_SOURCE_OWN_LABEL,
} from "@/lib/i18n/labels";

// Spec 373 D3 — the SSOT labels for the payment_source enum (fact-check: never
// invent parallel terms; these three already exist for the record form).
const SOURCE_LABELS: Record<string, string> = {
  company_card: PAYMENT_SOURCE_CARD_LABEL,
  own_money: PAYMENT_SOURCE_OWN_LABEL,
  company_direct: PAYMENT_SOURCE_DIRECT_LABEL,
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-edge bg-card flex flex-col gap-1 rounded-xl border p-4">
      <span className="text-ink-secondary text-xs font-medium">{label}</span>
      <span className="text-ink text-lg font-semibold">{value}</span>
    </div>
  );
}

export function ExpenseSummary({
  summary,
  allScope = false,
  bySource,
  monthTitle,
}: {
  summary: MyExpenseSummary;
  // Spec 373 D3 — under ทั้งหมด both figures go firm-wide, so the pending tile
  // must stop claiming "(ของคุณ)" and the source subtotal line appears.
  allScope?: boolean;
  bySource?: SourceSpend[];
  monthTitle?: string;
}) {
  const max = Math.max(1, ...summary.byCategory.map((c) => c.total));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label={monthTitle ?? EXPENSE_MONTH_TOTAL_LABEL}
          value={bahtWithSymbol(summary.monthTotal)}
        />
        <StatTile
          label={allScope ? EXPENSE_PENDING_TOTAL_ALL_LABEL : EXPENSE_PENDING_TOTAL_LABEL}
          value={bahtWithSymbol(summary.pendingReimburse)}
        />
      </div>

      {allScope && bySource && bySource.length > 0 && (
        <div className="border-edge bg-card flex flex-col gap-1.5 rounded-xl border p-4">
          <span className="text-ink-secondary text-xs font-medium">
            {EXPENSE_PAYMENT_SOURCE_LABEL}
          </span>
          <ul className="flex flex-col gap-1">
            {bySource.map((s) => (
              <li key={s.source} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">{SOURCE_LABELS[s.source] ?? s.source}</span>
                <span className="text-ink font-semibold tabular-nums">
                  {bahtWithSymbol(s.total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
