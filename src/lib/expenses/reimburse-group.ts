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
  // Spec 373 D5 — validate-before-pay: review + doc state joined from the
  // spec-345 RPC by the page. Optional so the loader's raw rows still typecheck;
  // the queue renders the chips (and the voucher door) only when present —
  // absent state must never render as a fake "รอตรวจ".
  reviewStatus?: "pending" | "flagged" | "verified";
  docCount?: number;
  docsExpected?: "expected" | "no_path_yet" | "not_expected";
}

// Spec 373 §5 — the queue COMPONENT requires the enriched shape: absent review
// state must be unrepresentable there (it would render a dead-end row with no
// button, no chip and no door). The page enrichment guarantees these fields.
export type ReviewedReimbursableRow = ReimbursableRow & {
  reviewStatus: NonNullable<ReimbursableRow["reviewStatus"]>;
  docCount: number;
};

export interface ReimburseGroup<T extends ReimbursableRow = ReimbursableRow> {
  userId: string;
  name: string | null;
  total: number;
  items: T[];
}

export function groupByReimburseTarget<T extends ReimbursableRow>(rows: T[]): ReimburseGroup<T>[] {
  const byUser = new Map<string, ReimburseGroup<T>>();
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
