// Spec 248 — the pure pairing lens over current photos.
//
// A defect photo (the PM's evidence, phase 'defect') demands an after_fix
// photo shot from the same angle; the answer records its target via
// answers_photo_id (U1 guard trigger pins same-WP + same-round + current
// target). This module derives, for ONE round, which defect photos are
// answered and which still await their re-shoot — consumed by the WP detail
// (paired capture slots + CTA routing), the review page (pairs display), and
// the U4 submit gate. Pure; callers feed the already-current-filtered
// photosByPhase (anti-join + tombstone, ADR 0009/0015), so a removed answer
// un-answers its defect photo by construction and a dangling answer (target
// no longer current) counts nowhere.

interface PairableRow {
  id: string;
  rework_round: number;
  answers_photo_id: string | null;
}

export interface DefectPair<R extends PairableRow = PairableRow> {
  defect: R;
  /** Current after_fix rows of the same round answering this defect photo. */
  answers: R[];
}

export interface DefectPairing<R extends PairableRow = PairableRow> {
  /** One entry per current defect photo of the round, input order kept. */
  pairs: DefectPair<R>[];
  unansweredCount: number;
  /** True when every defect photo of the round is answered — including the
   *  zero-defect (text-only / legacy) round. Gates the free shutter (U3)
   *  and the pairing half of the submit rule (U4). */
  allAnswered: boolean;
}

export function pairDefectPhotos<R extends PairableRow>(
  currentPhotos: { defect: ReadonlyArray<R>; after_fix: ReadonlyArray<R> },
  round: number,
): DefectPairing<R> {
  const roundFixes = currentPhotos.after_fix.filter((f) => f.rework_round === round);
  const pairs = currentPhotos.defect
    .filter((d) => d.rework_round === round)
    .map((defect) => ({
      defect,
      answers: roundFixes.filter((f) => f.answers_photo_id === defect.id),
    }));
  const unansweredCount = pairs.filter((p) => p.answers.length === 0).length;
  return { pairs, unansweredCount, allAnswered: unansweredCount === 0 };
}
