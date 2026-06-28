// Spec 216 — the rework cycle to stamp on a NEW photo_logs row.
//
// after_fix (หลังแก้ไข) photos belong to the WP's *current* rework cycle, so they
// carry the WP's rework_round. Every other phase (before/during/after) is part of
// the original work cycle and stays round 0. Pure so the write path's stamping
// rule is unit-testable without a Supabase mock.

import type { PhotoPhase } from "@/lib/db/enums";

export function photoReworkRoundFor(phase: PhotoPhase, wpReworkRound: number): number {
  return phase === "after_fix" ? wpReworkRound : 0;
}
