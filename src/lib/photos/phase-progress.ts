// Phase-progress derivation for the spec 54 progress bar. Pure function
// over per-phase current-photo counts (the selectCurrentPhotosByPhase
// output) — no I/O, unit-tested directly.
//
// Reading: doneCount = phases that have at least one current photo;
// currentPhase = the LAST phase (before → during → after) with photos —
// the phase work is actually sitting in — or 'before' when nothing has
// been shot yet. Segments render green for phases passed (photos exist
// and a later phase is current), blue for the current phase (only if it
// has photos), zinc for everything else — including a skipped middle
// phase (gap stays visibly un-shot).

import type { Database } from "@/lib/db/database.types";

export type PhotoPhase = Database["public"]["Enums"]["photo_phase"];

export const PHASE_ORDER: ReadonlyArray<PhotoPhase> = ["before", "during", "after"];

export type PhaseSegment = "complete" | "current" | "empty";

export interface PhaseProgress {
  doneCount: number;
  currentPhase: PhotoPhase;
  segments: ReadonlyArray<PhaseSegment>;
}

export function derivePhaseProgress(counts: Record<PhotoPhase, number>): PhaseProgress {
  let lastWithPhotos = -1;
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i];
    if (phase !== undefined && counts[phase] > 0) lastWithPhotos = i;
  }

  const doneCount = PHASE_ORDER.filter((p) => counts[p] > 0).length;
  const currentPhase = PHASE_ORDER[lastWithPhotos] ?? "before";

  const segments = PHASE_ORDER.map((phase, i): PhaseSegment => {
    if (counts[phase] === 0) return "empty";
    return i === lastWithPhotos ? "current" : "complete";
  });

  return { doneCount, currentPhase, segments };
}
