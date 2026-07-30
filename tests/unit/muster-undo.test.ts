// Writing failing test first.
//
// Spec 379 U2 — the sweep half of the undo doors. Pure functions only:
//
//  - `undoableSession` says WHICH outcomes may be retracted and which muster
//    session the retraction names. `muster_undo_scan` DELETES the attendance
//    row, so only outcomes whose write CREATED one qualify — `checked_out` and
//    `ot_closed` are writes too, but they merely stamp `out_at` on a row that
//    already existed, and deleting it would take the worker's morning check-in
//    with it (spec 379 §5: no un-checkout in v1).
//  - `markUndone` folds the retraction back into the tally, mirroring
//    `markFailed`'s addedIds removal.

import { describe, expect, it } from "vitest";
import {
  EMPTY_SWEEP,
  markUndone,
  recordScan,
  undoableSession,
  type ClassifiedScan,
  type SweepOutcomeKind,
  type SweepState,
} from "@/lib/muster/sweep";

const ALL_KINDS: SweepOutcomeKind[] = [
  "added",
  "added_team_changed",
  "added_first_time",
  "already_here",
  "other_team",
  "unknown_badge",
  "failed",
  "checked_out",
  "already_out",
  "not_checked_in",
  "ot_opened",
  "ot_already_open",
  "ot_already_closed",
  "ot_closed",
  "no_ot",
  "undone",
];

function scan(over: Partial<ClassifiedScan> = {}): ClassifiedScan {
  return {
    workerId: "w1",
    name: "จรูญ โสภา",
    kind: "added",
    detail: null,
    shouldWrite: true,
    teamId: "team-nan",
    ...over,
  };
}

describe("undoableSession — which outcomes may be retracted", () => {
  it("names 'regular' for every outcome that created a regular attendance row", () => {
    expect(undoableSession("added")).toBe("regular");
    expect(undoableSession("added_first_time")).toBe("regular");
    expect(undoableSession("added_team_changed")).toBe("regular");
  });

  it("names 'ot' for ot_opened — muster_scan_in inserts a SEPARATE session='ot' row", () => {
    expect(undoableSession("ot_opened")).toBe("ot");
  });

  // The whole point of the predicate. A check-out write is not a row this RPC
  // may delete: `muster_scan_out` stamps `out_at` on the existing row, so an
  // "undo" here would erase the worker's whole day.
  it("refuses checked_out and ot_closed even though both WROTE", () => {
    expect(undoableSession("checked_out")).toBeNull();
    expect(undoableSession("ot_closed")).toBeNull();
  });

  // Exhaustive over the whole domain, not a hand-picked few: a new outcome kind
  // must be classified deliberately, and the POSITIVE set is pinned exactly so
  // that adding a member reds this test in the ADD direction too.
  it("is exactly {added, added_first_time, added_team_changed, ot_opened} over the whole domain", () => {
    expect(ALL_KINDS.filter((k) => undoableSession(k) !== null).sort()).toEqual(
      ["added", "added_first_time", "added_team_changed", "ot_opened"].sort(),
    );
  });

  it("never offers an undo of an undo", () => {
    expect(undoableSession("undone")).toBeNull();
  });
});

describe("markUndone — the tally fold", () => {
  function seeded(): SweepState {
    let s = recordScan(EMPTY_SWEEP, scan({ workerId: "w1", name: "จรูญ" }), 1_000);
    s = recordScan(s, scan({ workerId: "w2", name: "มิตร" }), 2_000);
    return s;
  }

  it("rewrites the named entry to `undone` and clears its note", () => {
    const s = seeded();
    const target = s.entries.find((e) => e.workerId === "w1")!;
    const after = markUndone(s, target.seq);
    expect(after.entries.find((e) => e.seq === target.seq)).toMatchObject({
      outcome: "undone",
      detail: null,
    });
  });

  // The mirror of markFailed (sweep.ts) — the id must LEAVE addedIds, or the
  // closing router.refresh() count and the "already added this sweep"
  // classification both go on believing the worker is on the team.
  it("removes the worker from addedIds, leaving the other add intact", () => {
    const s = seeded();
    expect(s.addedIds).toEqual(["w1", "w2"]);
    const target = s.entries.find((e) => e.workerId === "w1")!;
    expect(markUndone(s, target.seq).addedIds).toEqual(["w2"]);
  });

  it("leaves every other entry untouched", () => {
    const s = seeded();
    const target = s.entries.find((e) => e.workerId === "w1")!;
    const other = s.entries.find((e) => e.workerId === "w2")!;
    expect(markUndone(s, target.seq).entries.find((e) => e.seq === other.seq)).toEqual(other);
  });

  it("is a no-op for a seq this sweep does not hold", () => {
    const s = seeded();
    expect(markUndone(s, 9_999)).toBe(s);
  });

  // Keyed on SEQ, not workerId. markFailed/markMoved rewrite the NEWEST entry
  // for a worker, which is the wrong row here: the undo button is rendered per
  // ENTRY, and a re-tap of an already-added name produces a newer `already_here`
  // row above the add the SA is actually pointing at.
  it("undoes the entry the SA tapped, not merely the worker's newest row", () => {
    let s = recordScan(EMPTY_SWEEP, scan({ workerId: "w1" }), 1_000);
    const added = s.entries[0]!;
    s = recordScan(s, scan({ workerId: "w1", kind: "already_here", shouldWrite: false }), 2_000);
    const after = markUndone(s, added.seq);
    expect(after.entries.find((e) => e.seq === added.seq)?.outcome).toBe("undone");
    expect(after.entries.filter((e) => e.outcome === "already_here")).toHaveLength(1);
    expect(after.addedIds).toEqual([]);
  });
});
