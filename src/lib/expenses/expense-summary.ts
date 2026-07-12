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
