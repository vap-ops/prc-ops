// Spec 100 — dashboard money helpers (PM/super only; rendered server-side
// behind requireRole(PM_ROLES), fed by admin-client reads). Pure.

// Purchase-request statuses that represent money actually committed/spent.
// requested/approved/rejected/cancelled are NOT spend.
export const SPEND_STATUSES: ReadonlySet<string> = new Set([
  "purchased",
  "on_route",
  "delivered",
  "site_purchased",
]);

// Material spend = Σ amount over spend-status PRs that recorded a price.
// amount is often null (site-staff PRs / site purchases don't capture it), so
// this is a PARTIAL figure — the UI discloses that.
export function sumMaterials(
  prs: ReadonlyArray<{ status: string; amount: number | null }>,
): number {
  let total = 0;
  for (const pr of prs) {
    if (SPEND_STATUSES.has(pr.status) && pr.amount != null) total += pr.amount;
  }
  return total;
}

// Spec 195 follow-up — store-issued material cost. เบิก (stock_issues) draws
// material from the on-site store TO a work package. Store-bound material comes
// from WP-less purchase requests, which sumMaterials EXCLUDES (no WP to attribute
// at purchase, ADR 0063) — so this is disjoint from the purchase sum and additive
// with no double-count. Valued at COST (total_cost) to match the dashboard's
// external-spend basis (labor at cost, purchases at the supplier amount); the
// store's internal transfer margin (the sell layer that wp_profit folds in) is
// NOT money out the door, so it stays out of a budget-vs-spend view. Reversed
// issues never charged a WP and are filtered out at the query, not here.
export function sumStoreIssues(issues: ReadonlyArray<{ total_cost: number | null }>): number {
  let total = 0;
  for (const i of issues) {
    if (i.total_cost != null) total += i.total_cost;
  }
  return total;
}

export interface BudgetStatus {
  hasBudget: boolean;
  budget: number | null;
  spend: number;
  remaining: number | null;
  /** rounded % of budget used; null when there is no budget to compare against. */
  pctUsed: number | null;
  over: boolean;
}

export function budgetStatus(budget: number | null, spend: number): BudgetStatus {
  const hasBudget = budget != null && budget > 0;
  if (!hasBudget) {
    return { hasBudget: false, budget, spend, remaining: null, pctUsed: null, over: false };
  }
  return {
    hasBudget: true,
    budget,
    spend,
    remaining: budget - spend,
    pctUsed: Math.round((spend / budget) * 100),
    over: spend > budget,
  };
}
