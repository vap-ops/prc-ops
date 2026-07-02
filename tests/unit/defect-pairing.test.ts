// Writing failing test first.
//
// Spec 248 U3/U4 — the pure pairing lens over current photos: which defect
// photos of the CURRENT round are answered by which current after_fix rows
// (answers_photo_id), which still await their same-angle re-shoot, and
// whether the free (unpaired) after_fix shutter is allowed. The caller feeds
// the already-current-filtered photosByPhase (anti-join + tombstone, ADR
// 0009/0015), so a deleted answer un-answers its defect photo by construction.

import { describe, expect, it } from "vitest";

import { pairDefectPhotos } from "@/lib/photos/defect-pairing";

type Row = {
  id: string;
  rework_round: number;
  answers_photo_id: string | null;
};

const defect = (id: string, round: number): Row => ({
  id,
  rework_round: round,
  answers_photo_id: null,
});
const fix = (id: string, round: number, answers: string | null): Row => ({
  id,
  rework_round: round,
  answers_photo_id: answers,
});

describe("pairDefectPhotos (spec 248)", () => {
  it("pairs each current-round defect photo with its answering after_fix rows", () => {
    const result = pairDefectPhotos(
      {
        defect: [defect("d1", 2), defect("d2", 2)],
        after_fix: [fix("f1", 2, "d1"), fix("f2", 2, "d1"), fix("f3", 2, null)],
      },
      2,
    );
    expect(result.pairs).toHaveLength(2);
    expect(result.pairs[0]!.defect.id).toBe("d1");
    expect(result.pairs[0]!.answers.map((a) => a.id)).toEqual(["f1", "f2"]);
    expect(result.pairs[1]!.defect.id).toBe("d2");
    expect(result.pairs[1]!.answers).toEqual([]);
    expect(result.unansweredCount).toBe(1);
    expect(result.allAnswered).toBe(false);
  });

  it("ignores defect photos and answers from OTHER rounds", () => {
    const result = pairDefectPhotos(
      {
        defect: [defect("d-old", 1), defect("d-now", 2)],
        // f-old answers d-now but was shot in round 1 — round-scoped out.
        after_fix: [fix("f-old", 1, "d-now")],
      },
      2,
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.defect.id).toBe("d-now");
    expect(result.pairs[0]!.answers).toEqual([]);
    expect(result.unansweredCount).toBe(1);
  });

  it("a round with no defect photos is all-answered (text-only defect / legacy)", () => {
    const result = pairDefectPhotos({ defect: [], after_fix: [fix("f1", 2, null)] }, 2);
    expect(result.pairs).toEqual([]);
    expect(result.unansweredCount).toBe(0);
    expect(result.allAnswered).toBe(true);
  });

  it("an answer pointing at a photo that is no longer current dangles harmlessly", () => {
    // d-gone was tombstoned → not in the current defect list; its old answer
    // must not resurrect it nor count anywhere.
    const result = pairDefectPhotos(
      { defect: [defect("d1", 2)], after_fix: [fix("f1", 2, "d-gone")] },
      2,
    );
    expect(result.pairs[0]!.answers).toEqual([]);
    expect(result.unansweredCount).toBe(1);
  });
});
