// Spec 327 U2 — the ขอบเขต supply overlay (pure part, no I/O). Aggregates the
// selected project's PR rows into per-WP procurement chips; the WP list wearing
// these chips is the view's reason to exist (without them it duplicates
// /projects/[id]).
//
// Anchoring: ADR 0065 — work_package_id ?? requested_from_work_package_id via
// the U1 SSOT helper. A PR whose anchor resolves to NO known WP (both columns
// null = store restock, or an anchor outside this project's WP set) lands in
// the PROJECT BUCKET — surfaced above the list, never dropped (§0.1).
// Late-risk delegates to selectLateRisk (late-risk.ts — the one definition);
// this module only picks each WP's WORST (max) late eta for the conflict line.

import { anchorWorkPackageId, selectLateRisk, type LateRiskRow } from "./late-risk";
import { ACTIVE_REQUEST_BANDS, requestBand } from "./request-bands";

/** The PR fields the overlay reads — exactly the late-risk row shape. */
export type OverlayPrRow = LateRiskRow;

export interface OverlayWpInput {
  id: string;
  plannedStart: string | null;
}

export interface WpSupplyOverlay {
  /** PRs in an active band anchored to this WP. */
  openCount: number;
  /** The in_transit subset (purchased / on_route). */
  incomingCount: number;
  /** Min eta among in_transit rows — the next truck. Null = none dated. */
  nextArrival: string | null;
  /** The WORST (max) late eta among this WP's late-risk rows (U1 SSOT), or null. */
  lateEta: string | null;
  /** WP appears in the project's supply_plan_lines WP set. */
  hasPlan: boolean;
}

export interface ProjectBucket {
  openCount: number;
  incomingCount: number;
  nextArrival: string | null;
}

const OPEN_BANDS = new Set<string>(ACTIVE_REQUEST_BANDS);

export function buildWpSupplyOverlay(
  wps: ReadonlyArray<OverlayWpInput>,
  prRows: ReadonlyArray<OverlayPrRow>,
  planLineWpIds: ReadonlySet<string>,
): { byWp: Map<string, WpSupplyOverlay>; projectBucket: ProjectBucket } {
  const byWp = new Map<string, WpSupplyOverlay>(
    wps.map((wp) => [
      wp.id,
      {
        openCount: 0,
        incomingCount: 0,
        nextArrival: null,
        lateEta: null,
        hasPlan: planLineWpIds.has(wp.id),
      },
    ]),
  );
  const projectBucket: ProjectBucket = { openCount: 0, incomingCount: 0, nextArrival: null };

  const minDate = (a: string | null, b: string | null): string | null => {
    if (a === null) return b;
    if (b === null) return a;
    return a <= b ? a : b;
  };

  for (const r of prRows) {
    const band = requestBand(r.status);
    if (!OPEN_BANDS.has(band)) continue;
    const anchorId = anchorWorkPackageId(r);
    const target = anchorId !== null ? byWp.get(anchorId) : undefined;
    const incoming = band === "in_transit";
    if (target) {
      target.openCount += 1;
      if (incoming) {
        target.incomingCount += 1;
        target.nextArrival = minDate(target.nextArrival, r.eta);
      }
    } else {
      projectBucket.openCount += 1;
      if (incoming) {
        projectBucket.incomingCount += 1;
        projectBucket.nextArrival = minDate(projectBucket.nextArrival, r.eta);
      }
    }
  }

  // Late-risk: the SSOT flags the rows; here we only distribute each flagged
  // row onto its anchor WP, keeping the WORST (latest) eta for the conflict.
  const wpById = new Map(wps.map((wp) => [wp.id, { plannedStart: wp.plannedStart }]));
  for (const flagged of selectLateRisk(prRows, wpById)) {
    const anchorId = anchorWorkPackageId(flagged);
    const target = anchorId !== null ? byWp.get(anchorId) : undefined;
    if (!target || flagged.eta === null) continue;
    if (target.lateEta === null || flagged.eta > target.lateEta) target.lateEta = flagged.eta;
  }

  return { byWp, projectBucket };
}
