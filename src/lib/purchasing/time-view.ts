// Spec 327 U3 — the เวลา view's pure core. Two questions of the selected
// project: which supplies land AFTER their work starts (the late-risk LIST —
// the U1 SSOT's flagged rows, enriched + ordered most-late first), and what
// happens THIS WEEK (arrivals × WPs starting/running — the week radar,
// Sunday-first weekOf convention, calendar-grid.ts).
//
// The ?view= sub-view is a QUERY param, not a sub-route: the bottom-tab active
// rule is a query-blind longest-pathname-prefix, so a route would double-light
// tabs (and churn the page classifier). Parsed like IncomingLens.

import { anchorWorkPackageId, selectLateRisk, type LateRiskRow } from "./late-risk";
import { requestBand } from "./request-bands";

/** U4 adds "timeline" to this union — one switcher, three sub-views. */
export type TimeView = "late" | "week";

export function parseTimeView(value: string | null | undefined): TimeView {
  return value === "week" ? "week" : "late";
}

/** The PR fields the เวลา lists render (no ฿ — PR_LIST_COLUMNS subset). */
export interface TimePrRow extends LateRiskRow {
  id: string;
  prNumber: number;
  itemDescription: string;
}

export interface TimeWpRow {
  id: string;
  name: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

export interface LateRiskListItem extends TimePrRow {
  wpName: string;
  plannedStart: string;
  daysLate: number;
}

// Private per-module, matching the overdue-attention.ts idiom (no shared home).
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** SSOT-flagged rows enriched with their anchor WP, most-late first. */
export function buildLateRiskList(
  prRows: ReadonlyArray<TimePrRow>,
  wps: ReadonlyArray<TimeWpRow>,
): LateRiskListItem[] {
  const wpById = new Map(wps.map((w) => [w.id, w]));
  return selectLateRisk(prRows, wpById)
    .flatMap((row) => {
      const anchorId = anchorWorkPackageId(row);
      const wp = anchorId !== null ? wpById.get(anchorId) : undefined;
      // The SSOT only flags rows whose anchor WP has a planned_start.
      if (!wp || wp.plannedStart === null || row.eta === null) return [];
      return [
        {
          ...row,
          wpName: wp.name,
          plannedStart: wp.plannedStart,
          daysLate: daysBetween(wp.plannedStart, row.eta),
        },
      ];
    })
    .sort((a, b) => b.daysLate - a.daysLate || a.eta!.localeCompare(b.eta!));
}

export interface WeekRadar<P extends TimePrRow, W extends TimeWpRow> {
  /** in_transit rows landing inside the week, eta ascending. */
  arrivals: P[];
  /** WPs overlapping the week (start ≤ week end, end ≥ week start or open-ended). */
  weekWps: Array<W & { startsThisWeek: boolean }>;
}

export function buildWeekRadar<P extends TimePrRow, W extends TimeWpRow>(
  wps: ReadonlyArray<W>,
  prRows: ReadonlyArray<P>,
  weekIsoDates: ReadonlyArray<string>,
): WeekRadar<P, W> {
  const weekStart = weekIsoDates[0] ?? "";
  const weekEnd = weekIsoDates[weekIsoDates.length - 1] ?? "";

  const arrivals = prRows
    .filter(
      (r) =>
        requestBand(r.status) === "in_transit" &&
        r.eta !== null &&
        r.eta >= weekStart &&
        r.eta <= weekEnd,
    )
    .sort((a, b) => a.eta!.localeCompare(b.eta!));

  // Undated WPs cannot be placed in a week — they live on the U4
  // ยังไม่กำหนดวันที่ shelf, not silently inside a radar that can't hold them.
  const weekWps = wps
    .filter(
      (w) =>
        w.plannedStart !== null &&
        w.plannedStart <= weekEnd &&
        (w.plannedEnd === null || w.plannedEnd >= weekStart),
    )
    .map((w) => ({ ...w, startsThisWeek: w.plannedStart! >= weekStart }));

  return { arrivals, weekWps };
}
