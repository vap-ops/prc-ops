// Spec 271 U2a §3 — variance classification vs a plan lens. Pure over minimal
// leaf inputs (the loader derives actuals via actuals.ts and feeds this); the
// ordered decision table below IS the spec table — first match wins. The class
// list mirrors the DB `variance_class` enum 1:1 (pinned in tests + a
// compile-time Record in labels.ts); U1's variance_snapshots rows use the same
// labels, so lib and job can never drift apart.

import type { WorkPackageStatus } from "@/lib/db/enums";

export const VARIANCE_CLASSES = [
  "unplanned",
  "no_evidence",
  "completed",
  "completed_undated",
  "never_started_past_end",
  "late_start",
  "late",
  "at_risk",
  "on_track",
] as const;
export type VarianceClass = (typeof VARIANCE_CLASSES)[number];

/** Triage severity for the pill's "worst" pick — strongest signal first (§3:
 *  never-started-past-end outranks LATE; completed/neutral classes trail). */
const WORST_ORDER: readonly VarianceClass[] = [
  "never_started_past_end",
  "late",
  "late_start",
  "at_risk",
  "on_track",
  "completed",
  "completed_undated",
  "no_evidence",
  "unplanned",
];

export interface VarianceLeafInput {
  plannedStart: string | null;
  plannedEnd: string | null;
  status: WorkPackageStatus;
  /** Derived anchors (actuals.ts); null = not reconstructable. */
  actualStart: string | null;
  actualEnd: string | null;
  hasEvidence: boolean;
}

export interface LeafVariance {
  class: VarianceClass;
  /** completed → actual_end − planned_end (signed); late → overrun days; else null. */
  slipDays: number | null;
  /** planned_end − planned_start + 1 (min 1); null when unplanned. */
  weightDays: number | null;
}

/** Whole-day difference between two ISO dates (b − a). */
export function dateDiffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const plannedWeight = (start: string, end: string): number =>
  Math.max(1, dateDiffDays(start, end) + 1);

/** §3 ordered decision table — first match wins. `todayIso` = Bangkok date. */
export function classifyLeaf(leaf: VarianceLeafInput, todayIso: string): LeafVariance {
  // 1 — unplanned (either date missing): excluded from weighted slip.
  if (leaf.plannedStart === null || leaf.plannedEnd === null) {
    return { class: "unplanned", slipDays: null, weightDays: null };
  }
  const weightDays = plannedWeight(leaf.plannedStart, leaf.plannedEnd);
  const complete = leaf.status === "complete";
  // 2 — no evidence at all ∧ not complete: neutral grey, never red off missing data.
  if (!leaf.hasEvidence && !complete) {
    return { class: "no_evidence", slipDays: null, weightDays };
  }
  // 3/4 — completed: slip vs plan when the anchor exists, tally-only otherwise.
  // A complete leaf never re-enters LATE (D7 — rework feeds quality, not slip).
  if (complete) {
    return leaf.actualEnd !== null
      ? { class: "completed", slipDays: dateDiffDays(leaf.plannedEnd, leaf.actualEnd), weightDays }
      : { class: "completed_undated", slipDays: null, weightDays };
  }
  const started = leaf.actualStart !== null || leaf.status !== "not_started";
  // 5/6 — never started: past-end is the strongest triage signal, then late-start.
  if (!started && todayIso > leaf.plannedEnd) {
    return { class: "never_started_past_end", slipDays: null, weightDays };
  }
  if (!started && todayIso > leaf.plannedStart) {
    return { class: "late_start", slipDays: null, weightDays };
  }
  // 7 — started and past the planned end: overrun days.
  if (started && todayIso > leaf.plannedEnd) {
    return { class: "late", slipDays: dateDiffDays(leaf.plannedEnd, todayIso), weightDays };
  }
  // 8 — in progress and inside the at-risk window: min(7d, half the duration).
  if (
    leaf.status === "in_progress" &&
    dateDiffDays(todayIso, leaf.plannedEnd) <= Math.min(7, Math.ceil(weightDays / 2))
  ) {
    return { class: "at_risk", slipDays: null, weightDays };
  }
  // 9 — on track.
  return { class: "on_track", slipDays: null, weightDays };
}

/** Coverage floor below which the pill goes neutral instead of red — the §3
 *  "suppress red below a coverage threshold" dial. Initial value picked on the
 *  004 calibration pilot (photos on ~10% of leaves at U1 time); operator-tunable
 *  by edit until a real dial table exists. */
export const COVERAGE_RED_FLOOR = 0.3;

export interface GroupVariancePill {
  worst: VarianceClass | null;
  counts: Partial<Record<VarianceClass, number>>;
  /** Evidenced share of leaves already past planned_start (0–100), null when
   *  no leaf is past its planned start yet. */
  coveragePct: number | null;
  lowCoverage: boolean;
}

export function groupVariancePill(
  leaves: ReadonlyArray<VarianceLeafInput>,
  todayIso: string,
): GroupVariancePill {
  const counts: Partial<Record<VarianceClass, number>> = {};
  for (const leaf of leaves) {
    const c = classifyLeaf(leaf, todayIso).class;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  const pastStart = leaves.filter((l) => l.plannedStart !== null && todayIso > l.plannedStart);
  const evidenced = pastStart.filter((l) => l.hasEvidence).length;
  const coveragePct =
    pastStart.length === 0 ? null : Math.round((evidenced / pastStart.length) * 100);
  const lowCoverage = coveragePct !== null && coveragePct < COVERAGE_RED_FLOOR * 100;
  const worst = WORST_ORDER.find((c) => (counts[c] ?? 0) > 0) ?? null;
  return { worst, counts, coveragePct, lowCoverage };
}
