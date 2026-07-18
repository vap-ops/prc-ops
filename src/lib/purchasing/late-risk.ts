// Spec 327 U1 — the late-risk SSOT. ONE definition, three consumers (U1
// dashboard counts, U2 per-WP row state, U3 list) — do NOT fork it.
//
// A PR is เสี่ยงช้า when ALL hold: it sits in an ACTIVE_REQUEST_BANDS band
// (done/closed never warn; an already-late PR still awaiting approval is the
// EARLIEST actionable warning, so this is deliberately not in_transit-only),
// its eta is non-null, its ANCHOR work package has a non-null planned_start,
// and eta > planned_start (ISO string compare — both are date strings).
// v1 uses PR.eta only; purchase_order_deliveries.eta is a deferred refinement
// (it has no project/WP column).

import type { Database } from "@/lib/db/database.types";
import { ACTIVE_REQUEST_BANDS, requestBand } from "./request-bands";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

/** The PR fields the late-risk predicate reads. Consumers pass richer rows
 * (generic T) and get the same rows back, flagged. */
export interface LateRiskRow {
  status: PurchaseRequestStatus;
  eta: string | null;
  workPackageId: string | null;
  requestedFromWorkPackageId: string | null;
}

/** What the predicate needs to know about a work package. */
export interface LateRiskWpInfo {
  plannedStart: string | null;
}

const OPEN_BANDS = new Set<string>(ACTIVE_REQUEST_BANDS);

/** ADR 0065 anchor rule: work_package_id ?? requested_from_work_package_id.
 * Joining work_package_id alone silently drops every modern store-bound PR. */
export function anchorWorkPackageId(row: {
  workPackageId: string | null;
  requestedFromWorkPackageId: string | null;
}): string | null {
  return row.workPackageId ?? row.requestedFromWorkPackageId;
}

/** The rows flagged เสี่ยงช้า, in input order. */
export function selectLateRisk<T extends LateRiskRow>(
  rows: ReadonlyArray<T>,
  wpById: ReadonlyMap<string, LateRiskWpInfo>,
): T[] {
  return rows.filter((r) => {
    if (r.eta === null) return false;
    if (!OPEN_BANDS.has(requestBand(r.status))) return false;
    const anchorId = anchorWorkPackageId(r);
    if (anchorId === null) return false;
    const plannedStart = wpById.get(anchorId)?.plannedStart ?? null;
    return plannedStart !== null && r.eta > plannedStart;
  });
}

export function countLateRisk(
  rows: ReadonlyArray<LateRiskRow>,
  wpById: ReadonlyMap<string, LateRiskWpInfo>,
): number {
  return selectLateRisk(rows, wpById).length;
}
