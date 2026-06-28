// Spec 216 — the rework-round dimension: stamping new photos (write side) and
// reading them back grouped by cycle (read side).
//
// after_fix (หลังแก้ไข) photos belong to the WP's *current* rework cycle, so they
// carry the WP's rework_round. Every other phase (before/during/after) is part of
// the original work cycle and stays round 0. All pure — unit-testable without a
// Supabase mock.

import type { PhotoPhase } from "@/lib/db/enums";
import type { PhotoLogRow } from "@/lib/photos/current-photos";

export function photoReworkRoundFor(phase: PhotoPhase, wpReworkRound: number): number {
  return phase === "after_fix" ? wpReworkRound : 0;
}

export interface AfterFixRoundGroup {
  round: number;
  photos: PhotoLogRow[];
}

// Group after_fix photos by their rework cycle, rounds ascending; input order is
// preserved within each round. The caller passes the current (non-superseded,
// non-tombstone) after_fix rows from selectCurrentPhotosByPhase.
export function groupAfterFixByRound(rows: ReadonlyArray<PhotoLogRow>): AfterFixRoundGroup[] {
  const byRound = new Map<number, PhotoLogRow[]>();
  for (const r of rows) {
    const bucket = byRound.get(r.rework_round);
    if (bucket) bucket.push(r);
    else byRound.set(r.rework_round, [r]);
  }
  return Array.from(byRound.keys())
    .sort((a, b) => a - b)
    .map((round) => ({ round, photos: byRound.get(round) ?? [] }));
}

// Map each rework round to the defect reason that opened it, parsed from the
// `wp_reopened_for_defect` audit_log rows (their payload carries reason + round,
// spec 216 U1). Rows missing a numeric round or a string reason are skipped.
export function reworkReasonsFromAuditRows(
  rows: ReadonlyArray<{ payload: unknown }>,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const r of rows) {
    const p = r.payload;
    if (typeof p !== "object" || p === null) continue;
    const { round, reason } = p as { round?: unknown; reason?: unknown };
    if (typeof round === "number" && typeof reason === "string" && reason.length > 0) {
      map.set(round, reason);
    }
  }
  return map;
}
