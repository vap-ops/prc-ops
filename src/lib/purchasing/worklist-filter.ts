// Spec 110 — procurement worklist filters + priority sort. Pure (no UI) so the
// filtering, the within-band priority sort, the picker options, and the URL
// serialization are all unit-tested independent of the page/components.
//
// Filtering is server-side via URL params (the ?mine / spec-56 pattern), applied
// to the shared row set so BOTH the phone card pipeline and the desktop grid get
// it. Bands already segment STAGE (spec 104); these are the cross-cutting slices
// bands can't express — supplier, project, overdue, and the status filter whose
// job is surfacing rejected/cancelled (banded OUT of the pipeline today).

import type { Database } from "@/lib/db/database.types";
import { PR_PRIORITY_RANK } from "./pending-order";
import { procurementBand, type ProcurementBand } from "./procurement-pipeline";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];
type PurchaseRequestPriority = Database["public"]["Enums"]["purchase_request_priority"];

export interface ProcurementFilter {
  /** Exact supplier text; null = all. */
  supplier: string | null;
  /** Project id; null = all. */
  projectId: string | null;
  /** Only in-transit POs past their ETA (the chase list). */
  overdue: boolean;
  /** Exact status; null = all. The banded-out rejected/cancelled escape (URL only). */
  status: PurchaseRequestStatus | null;
  /** Spec 138 U3: procurement band; null = all. The status-chip filter axis. */
  band: ProcurementBand | null;
}

interface FilterableRow {
  status: string;
  eta: string | null;
  supplier: string | null;
  projectId: string | null;
}

// AND-composes every set axis. todayIso = Bangkok civil date "YYYY-MM-DD";
// string compare is correct for zero-padded ISO dates.
export function matchesProcurementFilter(
  row: FilterableRow,
  filter: ProcurementFilter,
  todayIso: string,
): boolean {
  if (filter.supplier !== null && row.supplier !== filter.supplier) return false;
  if (filter.projectId !== null && row.projectId !== filter.projectId) return false;
  if (filter.status !== null && row.status !== filter.status) return false;
  if (filter.band !== null && procurementBand(row.status) !== filter.band) return false;
  if (filter.overdue) {
    if (procurementBand(row.status) !== "in_transit") return false;
    if (row.eta === null || !(row.eta < todayIso)) return false;
  }
  return true;
}

// Stable sort, critical → urgent → normal; same-priority order is preserved
// (Array.prototype.sort is stable in modern engines). Applied within each band.
export function sortByPriority<T extends { priority: PurchaseRequestPriority }>(
  items: ReadonlyArray<T>,
): T[] {
  return items.slice().sort((a, b) => PR_PRIORITY_RANK[a.priority] - PR_PRIORITY_RANK[b.priority]);
}

// Distinct, name-sorted supplier options (drives the picker). Built from the
// UNFILTERED rows so the filter can always be changed.
export function distinctSuppliers(rows: ReadonlyArray<{ supplier: string | null }>): string[] {
  return Array.from(
    new Set(rows.map((r) => r.supplier).filter((s): s is string => s !== null && s !== "")),
  ).sort((a, b) => a.localeCompare(b));
}

export interface ProjectOption {
  id: string;
  name: string;
}

// Distinct projects (by id), name-sorted. Rows with no project id are dropped.
export function distinctProjects(
  rows: ReadonlyArray<{ projectId: string | null; projectName: string | null }>,
): ProjectOption[] {
  const byId = new Map<string, string>();
  for (const r of rows) {
    if (r.projectId !== null && !byId.has(r.projectId)) byId.set(r.projectId, r.projectName ?? "");
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

// Serialize a filter to a /requests URL (drops empty axes). Shared by the
// server-rendered overdue tile and the client <select>s so the controls compose
// — changing one axis preserves the others.
export function buildWorklistQuery(filter: ProcurementFilter): string {
  const p = new URLSearchParams();
  if (filter.supplier) p.set("supplier", filter.supplier);
  if (filter.projectId) p.set("project", filter.projectId);
  if (filter.band) p.set("band", filter.band);
  if (filter.status) p.set("status", filter.status);
  if (filter.overdue) p.set("overdue", "1");
  const q = p.toString();
  return q ? `/requests?${q}` : "/requests";
}
