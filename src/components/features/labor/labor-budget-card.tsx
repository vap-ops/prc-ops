// Spec 205 U2 — the PM/PD labor budget vs actual card. Server Component: money is
// rendered server-side (the page is requireRole PM_ROLES, fed by admin-client
// reads); it never enters a field bundle. Sits at the top of the ค่าแรง section on
// the WP review page — the PM sets a labor cost ceiling and watches the live labor
// cost run against it. Embeds the inline LaborBudgetControl (client) for set/edit.

import { CARD } from "@/lib/ui/classes";
import type { LaborBudgetSummary } from "@/lib/labor/budget";
import { LaborBudgetControl } from "./labor-budget-control";
import {
  LABOR_BUDGET_LABEL,
  LABOR_BUDGET_USED_LABEL,
  LABOR_BUDGET_REMAINING_LABEL,
  LABOR_BUDGET_OVER_LABEL,
  LABOR_BUDGET_UNSET_LABEL,
} from "@/lib/i18n/labels";
import { bahtUnit as baht } from "@/lib/format";

interface LaborBudgetCardProps {
  summary: LaborBudgetSummary;
  workPackageId: string;
  revalidate: string;
}

// Tone → bar fill + remaining/over text. ok = on track, attn = ≥90% committed,
// over = past the ceiling.
const TONE = {
  ok: { bar: "bg-done-strong", text: "text-done-strong" },
  attn: { bar: "bg-attn", text: "text-attn-ink" },
  over: { bar: "bg-danger", text: "text-danger-ink" },
} as const;

export function LaborBudgetCard({ summary, workPackageId, revalidate }: LaborBudgetCardProps) {
  const { isSet, budget, spend, remaining, pctUsed, over, tone } = summary;
  const tint = TONE[tone];
  // Bar fill % — clamped 0..100. over (with no finite pct, e.g. a 0 budget) fills it.
  const fill = Math.min(100, Math.max(0, pctUsed ?? (over ? 100 : 0)));

  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink-secondary text-xs font-medium">{LABOR_BUDGET_LABEL}</p>
          {isSet ? (
            <p className="text-ink text-base font-bold">{baht(budget as number)}</p>
          ) : (
            <p className="text-ink-secondary text-sm">{LABOR_BUDGET_UNSET_LABEL}</p>
          )}
        </div>
        <LaborBudgetControl
          workPackageId={workPackageId}
          revalidate={revalidate}
          currentBudget={budget}
        />
      </div>

      {isSet ? (
        <>
          {/* Progress: clamped 0..100; over fills the bar and turns danger. */}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={fill}
            aria-label={`${LABOR_BUDGET_USED_LABEL} ${fill}%`}
            className="bg-sunk h-2 w-full overflow-hidden rounded-full"
          >
            <div className={`h-full rounded-full ${tint.bar}`} style={{ width: `${fill}%` }} />
          </div>
          <dl className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-secondary">{LABOR_BUDGET_USED_LABEL}</dt>
              <dd className="text-ink font-medium">{baht(spend)}</dd>
              {pctUsed !== null ? (
                <dd className="text-ink-secondary text-xs">({pctUsed}%)</dd>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <dt className={`${tint.text} text-xs font-medium`}>
                {over ? LABOR_BUDGET_OVER_LABEL : LABOR_BUDGET_REMAINING_LABEL}
              </dt>
              <dd className={`${tint.text} font-semibold`}>
                {baht(Math.abs(remaining as number))}
              </dd>
            </div>
          </dl>
        </>
      ) : null}
    </div>
  );
}
