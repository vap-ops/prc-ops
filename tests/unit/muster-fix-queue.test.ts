// Writing failing test first.
//
// Spec 400 U7 (D18 + D20) — the fix panel's queue: who the panel opens next once
// a correction on a day has been saved.
//
// The queue walks the DAY's workers, not `dayWorkList`. That was D18's first
// answer and the gate-check refuted it: `dayWorkList` carries only `openOut` and
// ZERO sessions in the database have a null `out_at`, so an anomalies-only queue
// advances through nothing on every day that exists. Anomalies survive as the
// ORDERING signal — they go first — which is the same thing the 07-24 sitting
// did by hand (9 OT rows out of 13 workers on the day).
//
// `next` is resolved from POST-WRITE data by the page, so this function is given
// the fresh roster every time and never caches a target.

import { describe, expect, it } from "vitest";

import { fixQueue, nextFixTarget } from "@/lib/muster/fix-queue";

const roster = [
  { workerId: "w-som", workerName: "สมชาย" },
  { workerId: "w-ana", workerName: "อนันตชัย" },
  { workerId: "w-pha", workerName: "ภานุพงษ์" },
];

describe("fixQueue — the order the panel walks", () => {
  it("puts the day's anomalies first, then everyone else by name", () => {
    // Thai collation, not code-point order: ภ < ส < อ.
    const q = fixQueue({ roster, anomalies: ["w-ana"] });
    expect(q.map((r) => r.workerId)).toEqual(["w-ana", "w-pha", "w-som"]);
    expect(q[0]?.problem).toBe(true);
    expect(q[1]?.problem).toBe(false);
  });

  it("still yields a walkable queue on a day with NO anomalies", () => {
    // The state every day in the database is in right now. An anomalies-only
    // queue would be empty here, which is the defect D20 records.
    const q = fixQueue({ roster, anomalies: [] });
    expect(q.map((r) => r.workerName)).toEqual(["ภานุพงษ์", "สมชาย", "อนันตชัย"]);
  });

  it("ignores an anomaly for someone who is not on the day", () => {
    // The two inputs are read separately; a stale id must not invent a row.
    const q = fixQueue({ roster, anomalies: ["w-ghost"] });
    expect(q).toHaveLength(3);
    expect(q.every((r) => !r.problem)).toBe(true);
  });
});

describe("nextFixTarget — where a save lands", () => {
  const q = fixQueue({ roster, anomalies: ["w-ana"] }); // ana, pha, som

  it("advances to the next person in the queue", () => {
    expect(nextFixTarget({ queue: q, justSaved: "w-ana" })).toEqual({ workerId: "w-pha" });
    expect(nextFixTarget({ queue: q, justSaved: "w-pha" })).toEqual({ workerId: "w-som" });
  });

  it("reports DONE after the last person rather than closing silently", () => {
    // A surface that vanishes is indistinguishable from a crash — the panel says
    // so instead (the silent-success rule).
    expect(nextFixTarget({ queue: q, justSaved: "w-som" })).toEqual({ done: true });
  });

  it("reports DONE when the day has nobody left to walk", () => {
    expect(nextFixTarget({ queue: [], justSaved: "w-ana" })).toEqual({ done: true });
  });

  it("opens the first person when the save came from someone off the queue", () => {
    // The worker was deleted from the day by the very save that redirected here
    // (muster_undo_scan), so they are no longer in the roster. Falling back to
    // the head is what keeps the queue walkable instead of dead-ending.
    expect(nextFixTarget({ queue: q, justSaved: "w-gone" })).toEqual({ workerId: "w-ana" });
  });

  it("is a no-op when no save asked to advance", () => {
    // ?fix= without ?fixNext= — the reader opened the panel by tapping a cell.
    expect(nextFixTarget({ queue: q, justSaved: null })).toBeNull();
  });
});
