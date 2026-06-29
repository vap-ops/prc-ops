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
//
// Store-first doctrine (U4): `storedPrIds` is the set of PR ids whose goods have
// entered the store (a `stock_receipt` exists for them). Those are EXCLUDED here
// because their cost is attributed at เบิก via sumStoreIssues — counting the PR
// amount too would double-count. Today the receive trigger only stocks WP-less
// PRs (already excluded upstream by having no WP), so this set is empty in
// practice and the guard is a no-op; once U1 auto-stocks WP-bound receives, it
// prevents the double-count with no further dashboard change.
export function sumMaterials(
  prs: ReadonlyArray<{ id: string; status: string; amount: number | null }>,
  storedPrIds: ReadonlySet<string> = new Set(),
): number {
  let total = 0;
  for (const pr of prs) {
    if (storedPrIds.has(pr.id)) continue;
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

// WP→store returns (spec 209) — material that was issued to a WP and then returned
// to the store. The return re-enters stock_on_hand at the issue cost (so its value
// lands in sumStorePool / projectPool), but return_stock_to_store leaves the
// originating stock_issues row NON-reversed (returns are forbidden on reversed
// issues), so its full cost stays in sumStoreIssues. The returned baht would be
// counted twice — once in WP issues, once in the store pool — unless it is netted
// out of the WP level. This mirrors wp_profit, which subtracts returned qty from each
// issue's cost. Valued at COST (total_cost) to match sumStoreIssues / sumStorePool.
export function sumStoreReturns(returns: ReadonlyArray<{ total_cost: number | null }>): number {
  let total = 0;
  for (const r of returns) {
    if (r.total_cost != null) total += r.total_cost;
  }
  return total;
}

// PD dashboard money split — project store pool. Material paid for at the PROJECT
// level that is currently in the store: it entered (a stock_receipt / a WP→store
// return) but has NOT been withdrawn (เบิก) to a work package, or has come back.
// Valued at COST via stock_on_hand.total_value — the live maintained balance
// (receipts/returns add, issues subtract, reversals restore). Issued material has
// LEFT stock_on_hand, so this is disjoint from sumStoreIssues — PROVIDED the WP level
// nets out WP→store returns (sumStoreReturns), since a return restores on-hand value
// while the originating issue stays counted in sumStoreIssues.
export function sumStorePool(rows: ReadonlyArray<{ total_value: number | null }>): number {
  let total = 0;
  for (const r of rows) {
    if (r.total_value != null) total += r.total_value;
  }
  return total;
}

// PD dashboard money split — the per-project breakdown the card renders.
// wpLevel = cost that reached a work package and stayed there: labor + WP materials +
// เบิก NET of WP→store returns (the single figure the card showed before, minus the
// returns fix). projectPool = store stock currently on hand (sumStorePool). The two
// are disjoint, so `total` is a true, no-double-count spend figure — and one that
// CORRECTS the old number, which omitted paid material still sitting in the store.
// `total` is what budgetStatus compares.
export interface SpendBreakdown {
  wpLevel: number;
  projectPool: number;
  total: number;
}

export function spendBreakdown(wpLevel: number, projectPool: number): SpendBreakdown {
  return { wpLevel, projectPool, total: wpLevel + projectPool };
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
