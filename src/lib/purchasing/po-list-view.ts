// Spec 262 U3 — pure view layer for the PO list (/requests/orders). Reuses
// buildPoDetailView (spec 134/260 — derived status + charges-aware grand
// total) per PO, adding two facts the detail view doesn't need: which
// project(s) a PO's active lines touch (for the project filter + column) and
// how many days it has been waiting (aging — undelivered POs only, per spec).

import type { PurchaseRequestStatus } from "@/lib/db/enums";
import { buildPoDetailView, isActiveLine, type PoDetailLine } from "@/lib/purchasing/po-detail";
import type { PoChargeAmount, PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";

export interface PoListAggregateLine {
  status: PurchaseRequestStatus;
  amount: number | null;
  projectId: string;
}

export interface PoListAggregateInput {
  id: string;
  poNumber: number;
  supplierId: string;
  supplierLabel: string;
  orderedAt: string | null;
  lines: PoListAggregateLine[];
  charges: PoChargeAmount[];
}

export interface PoListRow {
  id: string;
  poNumber: number;
  supplierId: string;
  supplierLabel: string;
  /** Distinct projects touched by the PO's ACTIVE lines (rejected/cancelled excluded). */
  projectIds: string[];
  projectLabel: string;
  lineCount: number;
  total: number;
  status: PurchaseOrderStatus;
  orderedAt: string | null;
  /** Whole days since ordered_at — null once received (nothing to chase) or
   * never ordered (no ordered_at). */
  agingDays: number | null;
}

/** A PO's active-line project(s) → the list column label: none → dash, one →
 * that project's name, more than one → "หลายโครงการ" (a mixed-project PO). */
export function deriveProjectLabel(
  activeProjectIds: ReadonlyArray<string>,
  nameById: ReadonlyMap<string, string>,
): string {
  const distinct = [...new Set(activeProjectIds)];
  if (distinct.length === 0) return "—";
  if (distinct.length === 1) return nameById.get(distinct[0]!) ?? "—";
  return "หลายโครงการ";
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function poAgingDays(
  orderedAt: string | null,
  status: PurchaseOrderStatus,
  todayIso: string,
): number | null {
  if (status === "received" || orderedAt === null) return null;
  return daysBetween(orderedAt, todayIso);
}

export function buildPoListRow(
  input: PoListAggregateInput,
  projectNameById: ReadonlyMap<string, string>,
  todayIso: string,
): PoListRow {
  const detailLines: PoDetailLine[] = input.lines.map((l) => ({
    status: l.status,
    amount: l.amount,
  }));
  const { status, total, activeLineCount } = buildPoDetailView(detailLines, input.charges);
  const activeProjectIds = input.lines
    .filter((l) => isActiveLine(l.status))
    .map((l) => l.projectId);
  return {
    id: input.id,
    poNumber: input.poNumber,
    supplierId: input.supplierId,
    supplierLabel: input.supplierLabel,
    projectIds: [...new Set(activeProjectIds)],
    projectLabel: deriveProjectLabel(activeProjectIds, projectNameById),
    lineCount: activeLineCount,
    total,
    status,
    orderedAt: input.orderedAt,
    agingDays: poAgingDays(input.orderedAt, status, todayIso),
  };
}

export interface PoListFilter {
  supplierId?: string;
  projectId?: string;
  /** Undelivered POs only (agingDays !== null) — the U4 home-tile pre-filter. */
  pendingOnly?: boolean;
}

export function filterPoRows(rows: ReadonlyArray<PoListRow>, filter: PoListFilter): PoListRow[] {
  return rows.filter(
    (r) =>
      (!filter.supplierId || r.supplierId === filter.supplierId) &&
      (!filter.projectId || r.projectIds.includes(filter.projectId)) &&
      (!filter.pendingOnly || r.agingDays !== null),
  );
}

export function sortPoRowsByOrderedAtDesc(rows: ReadonlyArray<PoListRow>): PoListRow[] {
  return [...rows].sort((a, b) => {
    if (a.orderedAt === null && b.orderedAt === null) return 0;
    if (a.orderedAt === null) return 1;
    if (b.orderedAt === null) return -1;
    return b.orderedAt.localeCompare(a.orderedAt);
  });
}
