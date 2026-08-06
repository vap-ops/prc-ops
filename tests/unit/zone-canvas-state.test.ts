// Writing failing test first.
//
// Spec 392 U2b — the canvas's optimistic write state, as a pure reducer.
//
// Every 🔴 the fresh-eyes review found lived in this machine when it was a
// tangle of `useState` calls inside the island, and none of them were
// assertable, because no test renders a Konva canvas. None of it needs a layout
// engine — it is bookkeeping over {draft, history, in-flight} — so it moves out
// here where the interleavings can be driven directly.
//
// The four defects being pinned:
//
//  ① A FAILED write rolled back by popping the LAST history entry rather than
//     its own. Drag A, drag B, A fails → B's undo entry is destroyed and A's
//     survives for a zone already rolled back.
//  ② A failed UNDO popped twice — once when the undo was issued, once in the
//     failure arm — so one refused undo cost two entries.
//  ③ The pre-write snapshot was taken from state that already included
//     UNCONFIRMED draft, so undo could restore geometry the database never
//     held.
//  ④ The draft entry was cleared only on failure, so a successful write pinned
//     that zone's geometry for the component's lifetime and the server row
//     could never win.

import { describe, expect, it } from "vitest";
import {
  canvasReducer,
  initialCanvasState,
  resolveZone,
  undoTarget,
  type CanvasState,
  type ZoneSnapshot,
} from "@/lib/zones/canvas-state";

const A = "zone-a";
const B = "zone-b";

const box = (x: number): ZoneSnapshot => ({
  shape: "rect",
  geometry: { x, y: 0.1, w: 0.2, h: 0.2 },
});

const SERVER_A = box(0.1);
const SERVER_B = box(0.5);

/** Commit and return both the new state and the sequence number issued. */
function commit(state: CanvasState, zoneId: string, server: ZoneSnapshot, next: ZoneSnapshot) {
  const after = canvasReducer(state, { type: "commit", zoneId, server, next });
  const write = after.inFlight.at(-1);
  if (!write) throw new Error("commit issued no in-flight write");
  return { state: after, seq: write.seq };
}

describe("a single write", () => {
  it("shows the new geometry immediately and remembers what to undo to", () => {
    const { state, seq } = commit(initialCanvasState, A, SERVER_A, box(0.3));
    expect(resolveZone(state, A, SERVER_A)).toEqual(box(0.3));

    const settled = canvasReducer(state, { type: "settled", seq, ok: true });
    expect(settled.history).toHaveLength(1);
    expect(settled.history[0]?.zoneId).toBe(A);
    expect(settled.history[0]?.previous).toEqual(SERVER_A);
  });

  it("④ clears the draft once the write lands, so the server row wins again", () => {
    const { state, seq } = commit(initialCanvasState, A, SERVER_A, box(0.3));
    const settled = canvasReducer(state, { type: "settled", seq, ok: true });
    expect(settled.draft[A]).toBeUndefined();
    // A later server render carrying the saved value renders it unmediated.
    expect(resolveZone(settled, A, box(0.3))).toEqual(box(0.3));
  });

  it("puts the zone back where it was when the write is refused", () => {
    const { state, seq } = commit(initialCanvasState, A, SERVER_A, box(0.3));
    const failed = canvasReducer(state, { type: "settled", seq, ok: false });
    expect(resolveZone(failed, A, SERVER_A)).toEqual(SERVER_A);
    expect(failed.history).toHaveLength(0);
  });
});

describe("① a failure must roll back ITS OWN write, not the newest one", () => {
  it("keeps B's undo entry when A's write fails after B's succeeded", () => {
    // Drag A (in flight), drag B (in flight), B lands, then A is refused.
    const a = commit(initialCanvasState, A, SERVER_A, box(0.3));
    const b = commit(a.state, B, SERVER_B, box(0.7));
    const afterB = canvasReducer(b.state, { type: "settled", seq: b.seq, ok: true });
    const afterA = canvasReducer(afterB, { type: "settled", seq: a.seq, ok: false });

    // B's entry is the one that must survive — it is the write that happened.
    expect(afterA.history.map((h) => h.zoneId)).toEqual([B]);
    expect(afterA.history[0]?.previous).toEqual(SERVER_B);
    // And A is back where the database has it.
    expect(resolveZone(afterA, A, SERVER_A)).toEqual(SERVER_A);
  });
});

describe("③ undo restores a state the database actually held", () => {
  it("takes the pre-write snapshot from the last CONFIRMED value, not from draft", () => {
    // Three drags on A. The first is refused; the second and third land.
    const one = commit(initialCanvasState, A, SERVER_A, box(0.2));
    const two = commit(one.state, A, SERVER_A, box(0.3));
    const three = commit(two.state, A, SERVER_A, box(0.4));

    // Settle against the state that HOLDS all three writes — `one.state` knows
    // only about the first, and a `settled` for a seq it has never seen is
    // correctly a no-op, which would make this test vacuous.
    let s = canvasReducer(three.state, { type: "settled", seq: one.seq, ok: false });
    s = canvasReducer(s, { type: "settled", seq: two.seq, ok: true });
    s = canvasReducer(s, { type: "settled", seq: three.seq, ok: true });

    // Every `previous` must be a value the DB held: the server row, then 0.3.
    // 0.2 was never persisted and must appear nowhere.
    expect(s.history.map((h) => h.previous)).toEqual([SERVER_A, box(0.3)]);
    expect(s.history.some((h) => h.previous.geometry === box(0.2).geometry)).toBe(false);
  });
});

describe("② a refused undo costs exactly one entry, and gives it back", () => {
  it("restores the history entry when the undo write itself fails", () => {
    const one = commit(initialCanvasState, A, SERVER_A, box(0.3));
    let s = canvasReducer(one.state, { type: "settled", seq: one.seq, ok: true });
    const two = commit(s, A, SERVER_A, box(0.5));
    s = canvasReducer(two.state, { type: "settled", seq: two.seq, ok: true });
    expect(s.history).toHaveLength(2);

    // Undo the newest — it names the state to write back.
    const target = undoTarget(s);
    expect(target?.snapshot).toEqual(box(0.3));

    const undo = canvasReducer(s, { type: "undo" });
    expect(undo.history).toHaveLength(1);

    // The undo write is refused. Exactly one entry comes back, not zero, and
    // the older entry is untouched.
    const undoWrite = undo.inFlight.at(-1);
    const refused = canvasReducer(undo, { type: "settled", seq: undoWrite!.seq, ok: false });
    expect(refused.history).toHaveLength(2);
    expect(resolveZone(refused, A, box(0.5))).toEqual(box(0.5));
  });

  it("does not resurrect an entry when the undo write succeeds", () => {
    const one = commit(initialCanvasState, A, SERVER_A, box(0.3));
    const s = canvasReducer(one.state, { type: "settled", seq: one.seq, ok: true });
    const undo = canvasReducer(s, { type: "undo" });
    const undoWrite = undo.inFlight.at(-1)!;
    const done = canvasReducer(undo, { type: "settled", seq: undoWrite.seq, ok: true });
    expect(done.history).toHaveLength(0);
    // The DB now holds the restored value, and the draft is gone so the next
    // server render — which will carry SERVER_A — is drawn unmediated.
    expect(done.confirmed[A]).toEqual(SERVER_A);
    expect(done.draft[A]).toBeUndefined();
  });

  it("is a no-op with nothing to undo", () => {
    expect(undoTarget(initialCanvasState)).toBeNull();
    expect(canvasReducer(initialCanvasState, { type: "undo" })).toBe(initialCanvasState);
  });
});

describe("the history is bounded", () => {
  it("keeps the most recent entries and drops the oldest", () => {
    let s: CanvasState = initialCanvasState;
    for (let i = 0; i < 30; i += 1) {
      const c = commit(s, A, SERVER_A, box(i / 100));
      s = canvasReducer(c.state, { type: "settled", seq: c.seq, ok: true });
    }
    expect(s.history.length).toBeLessThanOrEqual(20);
    // The newest entry undoes to the value written one step earlier.
    expect(undoTarget(s)?.snapshot).toEqual(box(28 / 100));
  });
});

describe("resolveZone", () => {
  it("prefers the server row when nothing is in flight", () => {
    expect(resolveZone(initialCanvasState, A, SERVER_A)).toEqual(SERVER_A);
  });

  it("keeps showing the drafted value while a write is still in flight", () => {
    const { state } = commit(initialCanvasState, A, SERVER_A, box(0.3));
    // A revalidation can deliver the OLD row mid-flight; the drag must not
    // visibly snap back only to jump forward again a moment later.
    expect(resolveZone(state, A, SERVER_A)).toEqual(box(0.3));
  });
});
