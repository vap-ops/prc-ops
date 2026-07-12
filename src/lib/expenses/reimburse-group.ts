// Spec 310 U5 — pure grouping for the reimburse queue. An awaiting-reimbursement
// expense is grouped by the person it's owed to; each group carries the running
// total. Pure (no server-only) so it's unit-testable and importable from the
// client queue component.

export interface ReimbursableRow {
  id: string;
  reimburseToUserId: string;
  reimburseToName: string | null;
  amount: number;
  categoryLabel: string | null;
  expenseDate: string;
  description: string;
}

export interface ReimburseGroup {
  userId: string;
  name: string | null;
  total: number;
  items: ReimbursableRow[];
}

export function groupByReimburseTarget(rows: ReimbursableRow[]): ReimburseGroup[] {
  const byUser = new Map<string, ReimburseGroup>();
  for (const r of rows) {
    const g = byUser.get(r.reimburseToUserId);
    if (g) {
      g.total += r.amount;
      g.items.push(r);
      if (g.name === null) g.name = r.reimburseToName;
    } else {
      byUser.set(r.reimburseToUserId, {
        userId: r.reimburseToUserId,
        name: r.reimburseToName,
        total: r.amount,
        items: [r],
      });
    }
  }
  return [...byUser.values()].sort((a, b) => b.total - a.total);
}
