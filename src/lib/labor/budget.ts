// Spec 205 U2 — per-WP labor budget vs actual. Pure derivation feeding the PM
// review card. Distinct from dashboard/spend's budgetStatus (which treats 0 as
// "no budget"): here NULL = unset (prompt the PM to set one) and 0 = a real
// budget of zero (any labor spend is over budget), because the data layer stores
// 0 ≠ NULL deliberately (spec 205 U1, pgTAP 226). Money values stay server-side —
// this carries no UI.

export type LaborBudgetTone = "ok" | "attn" | "over";

export interface LaborBudgetSummary {
  /** true when a labor budget has been set (including an explicit 0). */
  isSet: boolean;
  /** the set budget (baht), or null when unset. */
  budget: number | null;
  /** actual labor cost to date (baht). */
  spend: number;
  /** budget − spend when set; null when unset. */
  remaining: number | null;
  /** rounded % of budget used; null when unset or when budget is 0 with spend. */
  pctUsed: number | null;
  /** spend exceeds the budget (only meaningful when set). */
  over: boolean;
  tone: LaborBudgetTone;
}

// Amber once 90% of the budget is committed; red once over.
const ATTN_PCT = 90;

export function laborBudgetSummary(budget: number | null, spend: number): LaborBudgetSummary {
  if (budget === null) {
    return {
      isSet: false,
      budget: null,
      spend,
      remaining: null,
      pctUsed: null,
      over: false,
      tone: "ok",
    };
  }

  const over = spend > budget;
  // budget > 0 → a real percentage; budget 0 with no spend → 0%; budget 0 with
  // spend → undefined ratio (over, but no finite %). FLOOR, not round: rounding
  // up would show 100% (a full bar) while still under budget with money left
  // (over stays the single source of the "full/over" truth), and would also
  // trip the attn threshold at 89.5%. Floor keeps the displayed % honest and the
  // 90% amber boundary exact.
  const pctUsed = budget > 0 ? Math.floor((spend / budget) * 100) : spend > 0 ? null : 0;

  let tone: LaborBudgetTone = "ok";
  if (over) tone = "over";
  else if (pctUsed !== null && pctUsed >= ATTN_PCT) tone = "attn";

  return { isSet: true, budget, spend, remaining: budget - spend, pctUsed, over, tone };
}
