// Spec 310 U7 — pure aggregation for the personal expense dashboard. Group this
// month's spend by category (sorted big→small for the bar chart) + simple sums.
// Pure (no server-only) so it's unit-testable and importable from the client viz.

export interface CategorySpend {
  label: string;
  total: number;
}

export function aggregateCategorySpend(
  rows: { label: string | null; amount: number }[],
): CategorySpend[] {
  const byLabel = new Map<string, number>();
  for (const r of rows) {
    const label = r.label ?? "อื่นๆ";
    byLabel.set(label, (byLabel.get(label) ?? 0) + r.amount);
  }
  return [...byLabel.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

export function sumAmounts(rows: { amount: number }[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

// Spec 373 D3 — firm-wide spend by payment source (the card-statement
// reconciliation line). Sorted big→small like the category chart; a source with
// no spend is dropped, not rendered as ฿0. ⚠️ Payment source is orthogonal to
// reimbursement state — this is spend-by-source only, never a reimburse figure.
export interface SourceSpend {
  source: string;
  total: number;
}

export function aggregateSourceSpend(
  rows: { paymentSource: string; amount: number }[],
): SourceSpend[] {
  const bySource = new Map<string, number>();
  for (const r of rows) {
    bySource.set(r.paymentSource, (bySource.get(r.paymentSource) ?? 0) + r.amount);
  }
  return [...bySource.entries()]
    .map(([source, total]) => ({ source, total }))
    .filter((s) => s.total !== 0)
    .sort((a, b) => b.total - a.total);
}
