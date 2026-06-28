// Spec 213 U1 — assemble one material's movement log. Pure: it takes the five
// mapped movement source arrays for a single (project, item) and returns a
// chronological (newest-first) typed log with a signed on-hand delta, the
// cost-side figure to show, and a running balance per row. No I/O — the page does
// the RLS-scoped reads and maps rows into these inputs.
//
// Money rule (spec 213): cost-side figures only (unit/line cost, count variance
// value, reversal value delta). Sell price / margin (P&L-tier) never enters here.

export type MaterialLogKind = "receipt" | "issue" | "count" | "return" | "reversal";

export interface WorkPackageRef {
  code: string;
  name: string;
}

export interface ReceiptInput {
  id: string;
  at: string;
  createdAt: string;
  qty: number;
  unitCost: number | null;
  totalCost: number | null;
  actorId: string | null;
  note: string | null;
  supplierName: string | null;
}

export interface IssueInput {
  id: string;
  at: string;
  createdAt: string;
  qty: number;
  unitCost: number | null;
  totalCost: number | null;
  actorId: string | null;
  note: string | null;
  workPackage: WorkPackageRef | null;
}

export interface CountInput {
  id: string;
  at: string;
  createdAt: string;
  countedQty: number;
  systemQty: number;
  variance: number;
  varianceValue: number | null;
  actorId: string | null;
  note: string | null;
}

export interface ReturnInput {
  id: string;
  at: string;
  createdAt: string;
  qty: number;
  totalCost: number | null;
  actorId: string | null;
  note: string | null;
  workPackage: WorkPackageRef | null;
}

export interface ReversalInput {
  id: string;
  at: string;
  createdAt: string;
  qty: number;
  valueDelta: number | null;
  reverses: "receipt" | "issue";
  actorId: string | null;
  note: string | null;
}

export interface MaterialLogSources {
  receipts: ReceiptInput[];
  issues: IssueInput[];
  counts: CountInput[];
  returns: ReturnInput[];
  reversals: ReversalInput[];
}

export interface MaterialLogEntry {
  id: string;
  kind: MaterialLogKind;
  at: string;
  /** Signed effect on on-hand qty (receipt/return +, issue −, count = variance, reversal flips). */
  qtyDelta: number;
  /** Cost-side figure to display (line cost / variance value / value delta); never sell/margin. */
  cost: number | null;
  actorId: string | null;
  note: string | null;
  /** Set for issue / return movements. */
  workPackage: WorkPackageRef | null;
  /** Set for count movements (counted vs system snapshot). */
  count: { countedQty: number; systemQty: number } | null;
  /** Set for reversal movements (which movement was undone). */
  reverses: "receipt" | "issue" | null;
  /** Set for receipt movements. */
  supplierName: string | null;
  /** On-hand qty immediately after this movement (ascending running sum). */
  balanceAfter: number;
}

// Internal pre-balance shape: the display entry plus the sort-key metadata
// (createdAt) kept OUTSIDE the entry, so nothing extra leaks into the output and
// there is no throwaway destructure.
type Entry = Omit<MaterialLogEntry, "balanceAfter">;
interface Draft {
  entry: Entry;
  at: string;
  createdAt: string;
  id: string;
}

function draftFromReceipt(r: ReceiptInput): Draft {
  return {
    at: r.at,
    createdAt: r.createdAt,
    id: r.id,
    entry: {
      id: r.id,
      kind: "receipt",
      at: r.at,
      qtyDelta: r.qty,
      cost: r.totalCost,
      actorId: r.actorId,
      note: r.note,
      workPackage: null,
      count: null,
      reverses: null,
      supplierName: r.supplierName,
    },
  };
}

function draftFromIssue(i: IssueInput): Draft {
  return {
    at: i.at,
    createdAt: i.createdAt,
    id: i.id,
    entry: {
      id: i.id,
      kind: "issue",
      at: i.at,
      qtyDelta: -i.qty,
      cost: i.totalCost,
      actorId: i.actorId,
      note: i.note,
      workPackage: i.workPackage,
      count: null,
      reverses: null,
      supplierName: null,
    },
  };
}

function draftFromCount(c: CountInput): Draft {
  return {
    at: c.at,
    createdAt: c.createdAt,
    id: c.id,
    entry: {
      id: c.id,
      kind: "count",
      at: c.at,
      qtyDelta: c.variance,
      cost: c.varianceValue,
      actorId: c.actorId,
      note: c.note,
      workPackage: null,
      count: { countedQty: c.countedQty, systemQty: c.systemQty },
      reverses: null,
      supplierName: null,
    },
  };
}

function draftFromReturn(rt: ReturnInput): Draft {
  return {
    at: rt.at,
    createdAt: rt.createdAt,
    id: rt.id,
    entry: {
      id: rt.id,
      kind: "return",
      at: rt.at,
      qtyDelta: rt.qty,
      cost: rt.totalCost,
      actorId: rt.actorId,
      note: rt.note,
      workPackage: rt.workPackage,
      count: null,
      reverses: null,
      supplierName: null,
    },
  };
}

function draftFromReversal(rv: ReversalInput): Draft {
  return {
    at: rv.at,
    createdAt: rv.createdAt,
    id: rv.id,
    entry: {
      id: rv.id,
      kind: "reversal",
      at: rv.at,
      // Undoing a receipt removes its qty; undoing an issue adds it back.
      qtyDelta: rv.reverses === "receipt" ? -rv.qty : rv.qty,
      cost: rv.valueDelta,
      actorId: rv.actorId,
      note: rv.note,
      workPackage: null,
      count: null,
      reverses: rv.reverses,
      supplierName: null,
    },
  };
}

// Ascending order: by movement time, then created_at, then id — a stable,
// deterministic tie-break so equal-timestamp rows keep a fixed order.
function ascending(a: Draft, b: Draft): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildMaterialLog(sources: MaterialLogSources): MaterialLogEntry[] {
  const drafts: Draft[] = [
    ...sources.receipts.map(draftFromReceipt),
    ...sources.issues.map(draftFromIssue),
    ...sources.counts.map(draftFromCount),
    ...sources.returns.map(draftFromReturn),
    ...sources.reversals.map(draftFromReversal),
  ].sort(ascending);

  // Ascending running balance, then present newest-first.
  let balance = 0;
  const ascendingEntries: MaterialLogEntry[] = drafts.map((d) => {
    balance += d.entry.qtyDelta;
    return { ...d.entry, balanceAfter: balance };
  });

  return ascendingEntries.reverse();
}
