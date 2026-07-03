// Spec 100 — dashboard money helpers (PM/super only; rendered server-side
// behind requireRole(PM_ROLES), fed by admin-client reads). Pure.

import { round2 } from "@/lib/format";
import type { PoChargeType } from "@/lib/purchasing/purchase-order";

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

// PD dashboard money split — the two-colour spend bar. The bar stacks two segments
// over the budget track: wpLevel (ใช้ในงาน, consumed by work) then projectPool
// (พักในคลังโครงการ, paid-for stock still in the store). Each is a % of budget; the
// pool segment is clamped to whatever track wpLevel leaves, so the two never exceed
// 100% (an over-budget total simply clips at the track end). `over` keys the danger
// styling. No budget → an empty bar (the card hides it anyway).
export interface SpendBarSegments {
  /** wpLevel as % of budget, 0..100. */
  wpPct: number;
  /** projectPool as % of budget, clamped to the track wpLevel leaves (wpPct+poolPct ≤ 100). */
  poolPct: number;
  over: boolean;
}

export function spendBarSegments(
  breakdown: SpendBreakdown,
  budget: number | null,
): SpendBarSegments {
  if (budget == null || budget <= 0) return { wpPct: 0, poolPct: 0, over: false };
  // Round to whole percent (a 2px bar needs no more) — and clamp the pool to the
  // rounded remaining track so the two segments never sum past 100, even over budget.
  const wpPct = Math.max(0, Math.min(100, Math.round((breakdown.wpLevel / budget) * 100)));
  const poolPct = Math.max(
    0,
    Math.min(100 - wpPct, Math.round((breakdown.projectPool / budget) * 100)),
  );
  return { wpPct, poolPct, over: breakdown.total > budget };
}

// Spec 230 (ADR 0066 / S9) — the spend-by-หมวดงาน lens. One row per work-category,
// the amount being that category's net WP-level spend. Built by tagging each spend
// atom the dashboard already sums (labor + WP materials + เบิก − returns, plus the
// project store pool) with the work-category of its WP; atoms with no work-category
// (uncategorised WPs, and the project pool which has no WP) carry a null tag.
export interface WorkCategorySpend {
  /** The global work_categories id, or null for the unset/project-pool bucket. */
  workCategoryId: string | null;
  /** work_categories.name_th, or unsetLabel for the null bucket. */
  name: string;
  amount: number;
}

/**
 * Partition spend atoms by work-category. Each atom is a piece of the SAME total the
 * dashboard already computes, so the returned rows sum to that total — a true
 * partition, no double-count (a return is a negative atom, mirroring wp_profit's
 * netting). An atom whose workCategoryId is null OR not in nameById folds into a
 * single unset bucket (workCategoryId null). Rows that net to zero are dropped. Sorted
 * by amount desc (name asc tie-break); the unset bucket sorts last regardless of size.
 */
export function spendByWorkCategory(
  atoms: ReadonlyArray<{ workCategoryId: string | null; amount: number }>,
  nameById: ReadonlyMap<string, string>,
  unsetLabel: string,
): WorkCategorySpend[] {
  const sums = new Map<string | null, number>();
  for (const a of atoms) {
    // Anything that does not resolve to a known work-category is the unset bucket.
    const key =
      a.workCategoryId != null && nameById.has(a.workCategoryId) ? a.workCategoryId : null;
    sums.set(key, (sums.get(key) ?? 0) + a.amount);
  }
  const rows: WorkCategorySpend[] = [];
  for (const [key, amount] of sums) {
    if (amount === 0) continue;
    rows.push({
      workCategoryId: key,
      name: key === null ? unsetLabel : (nameById.get(key) ?? unsetLabel),
      amount,
    });
  }
  rows.sort((x, y) => {
    // The unset bucket always sorts last, whatever its amount.
    if (x.workCategoryId === null) return 1;
    if (y.workCategoryId === null) return -1;
    return y.amount - x.amount || x.name.localeCompare(y.name);
  });
  return rows;
}

// Spec 260 — PO-level charges (transport/other/discount) are committed spend the
// dashboard budget bars would otherwise miss. A charge belongs to a PO; the PO's
// member lines carry the project(s). This allocates each charge's SIGNED spend
// (transport/other add, discount subtracts — the amount is stored positive, the
// direction lives in the TYPE) across those projects PROPORTIONALLY by line
// weight, mirroring the GL poster's per-line allocation. The remainder satang
// lands on the largest weight so the per-project shares sum EXACTLY to the
// signed charge — the same exact-sum discipline as the poster. In practice a PO
// is one project (the whole charge lands there); the split only matters for the
// rare cross-project PO. The result folds into each project's spend total, so
// dashboard total = Σ line amounts + Σ allocated charges (unit-pinned).
export interface ChargeAllocation {
  charge_type: PoChargeType;
  /** Gross, ALWAYS positive — the direction comes from charge_type. */
  amount: number;
  /** The charge's PO member-line weights by project (line gross amounts). */
  projectWeights: ReadonlyArray<{ projectId: string; weight: number }>;
}

export function allocateChargeSpendByProject(
  charges: ReadonlyArray<ChargeAllocation>,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (projectId: string, amount: number) =>
    out.set(projectId, round2((out.get(projectId) ?? 0) + amount));

  for (const c of charges) {
    const signed = c.charge_type === "discount" ? -c.amount : c.amount;
    const weighted = c.projectWeights.filter((w) => w.weight > 0);
    const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);

    // Degenerate (no priced member line): attribute the whole charge to the first
    // listed project so the total is never silently dropped. Practical POs always
    // have priced lines, so this is a safety net, not the normal path.
    if (weighted.length === 0 || totalWeight <= 0) {
      const target = c.projectWeights[0]?.projectId;
      if (target != null) add(target, signed);
      continue;
    }

    // Largest weight first (id tie-break) so the remainder lands deterministically.
    const ranked = [...weighted].sort(
      (a, b) => b.weight - a.weight || a.projectId.localeCompare(b.projectId),
    );
    let assigned = 0;
    const shares = ranked.map((w) => {
      const share = round2((signed * w.weight) / totalWeight);
      assigned = round2(assigned + share);
      return { projectId: w.projectId, share };
    });
    // Exact-sum: the remainder satang lands on the largest share (index 0).
    const first = shares[0];
    if (first) first.share = round2(first.share + (signed - assigned));
    for (const s of shares) add(s.projectId, s.share);
  }
  return out;
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
