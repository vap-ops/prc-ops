// Spec 392 U2b — the canvas's optimistic write state, as a pure reducer.
//
// A drag has to show its result before the server has agreed to it, which means
// keeping three things straight at once: what the user currently SEES (draft),
// what the database is known to HOLD (confirmed), and which writes are still
// out (inFlight). When that lived as loose `useState` calls inside the island it
// carried four defects, none of which any test could reach — a canvas is opaque
// to RTL and jsdom has no layout engine. None of it actually needs pixels, so it
// lives here instead, where the interleavings are ordinary function calls.
//
// The four rules that fall out, each of which was broken:
//
//  ① A settled write is identified by its own SEQUENCE NUMBER. Rolling back "the
//     last thing that happened" is wrong the moment two zones are dragged close
//     together — the newest entry usually belongs to a different write.
//  ② UNDO pops its entry when issued and PUTS IT BACK if its own write is
//     refused. Popping again in the failure arm costs two entries for one
//     failure and strands the older state forever.
//  ③ The snapshot an undo restores comes from `confirmed`, never from `draft`.
//     Otherwise undo can write back geometry that only ever existed on screen.
//  ④ `draft` is cleared when a write LANDS, not only when it fails. A draft that
//     outlives its write pins the zone for the component's lifetime, so the
//     server row can never win — and a corruption arriving from elsewhere would
//     be invisible on the one surface that would have shown it.

import type { ZoneGeometry, ZoneShape } from "@/lib/zones/validate-zone";

export interface ZoneSnapshot {
  shape: ZoneShape;
  geometry: ZoneGeometry;
}

export interface InFlightWrite {
  seq: number;
  zoneId: string;
  /** What to go back to if this write is refused, and what an undo restores. */
  previous: ZoneSnapshot;
  next: ZoneSnapshot;
  /** An undo's own write: its failure must give the history entry BACK. */
  isUndo: boolean;
}

export interface HistoryEntry {
  zoneId: string;
  previous: ZoneSnapshot;
}

export interface CanvasState {
  /** What the user sees, for zones with an unsettled or just-settled write. */
  draft: Record<string, ZoneSnapshot>;
  /** What the database is known to hold. Seeded lazily from the server row. */
  confirmed: Record<string, ZoneSnapshot>;
  inFlight: InFlightWrite[];
  history: HistoryEntry[];
  /** Highest sequence already settled per zone, so a late response for an
      OLDER write cannot overwrite a newer one's confirmed value. */
  settledSeq: Record<string, number>;
  seq: number;
}

export type CanvasAction =
  | { type: "commit"; zoneId: string; server: ZoneSnapshot; next: ZoneSnapshot }
  | { type: "settled"; seq: number; ok: boolean }
  | { type: "undo" };

/** Deep enough for a drawing session; an unbounded stack is a leak. */
export const HISTORY_LIMIT = 20;

export const initialCanvasState: CanvasState = {
  draft: {},
  confirmed: {},
  inFlight: [],
  history: [],
  settledSeq: {},
  seq: 0,
};

/**
 * What the canvas should draw for a zone.
 *
 * The draft wins while it exists, because a revalidation can deliver the OLD
 * row mid-flight and a shape that snaps back only to jump forward again reads
 * as a bug. Once the write settles the draft is dropped and the server row is
 * authoritative again (rule ④).
 */
export function resolveZone(
  state: CanvasState,
  zoneId: string,
  server: ZoneSnapshot,
): ZoneSnapshot {
  return state.draft[zoneId] ?? server;
}

/** The entry an undo would act on, without mutating anything. */
export function undoTarget(state: CanvasState): { zoneId: string; snapshot: ZoneSnapshot } | null {
  const entry = state.history.at(-1);
  return entry ? { zoneId: entry.zoneId, snapshot: entry.previous } : null;
}

function withoutSeq(writes: readonly InFlightWrite[], seq: number): InFlightWrite[] {
  return writes.filter((w) => w.seq !== seq);
}

function issue(
  state: CanvasState,
  zoneId: string,
  previous: ZoneSnapshot,
  next: ZoneSnapshot,
  isUndo: boolean,
): CanvasState {
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    draft: { ...state.draft, [zoneId]: next },
    inFlight: [...state.inFlight, { seq, zoneId, previous, next, isUndo }],
  };
}

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "commit": {
      // Rule ③: the rollback/undo point is the last state the DATABASE held —
      // `confirmed` if this zone has ever settled, otherwise the server row we
      // were rendered with. Reading it off the drafted value would let an undo
      // restore something that never existed anywhere but the screen.
      const previous = state.confirmed[action.zoneId] ?? action.server;
      return issue(state, action.zoneId, previous, action.next, false);
    }

    case "settled": {
      const write = state.inFlight.find((w) => w.seq === action.seq);
      // Rule ①: identified by sequence, so a late failure cannot roll back a
      // different zone's successful write.
      if (!write) return state;

      const inFlight = withoutSeq(state.inFlight, action.seq);
      // Another write for the same zone may still be out; its draft must stand.
      const stillPending = inFlight.some((w) => w.zoneId === write.zoneId);

      if (action.ok) {
        // ⚠️ Out-of-order settles for the SAME zone: two drags go out, the
        // second answers first. Taking the later response as authoritative
        // would overwrite `confirmed` with the OLDER write's geometry, and the
        // canvas would then roll back to a value the database does not hold.
        // The highest settled sequence wins.
        const settledAt = state.settledSeq[write.zoneId] ?? 0;
        const stale = action.seq < settledAt;
        const confirmed = stale
          ? state.confirmed
          : { ...state.confirmed, [write.zoneId]: write.next };
        const settledSeq = stale
          ? state.settledSeq
          : { ...state.settledSeq, [write.zoneId]: action.seq };
        const draft = { ...state.draft };
        if (!stillPending) delete draft[write.zoneId]; // rule ④
        // ⭐ The undo point is read HERE, not at commit time. Three drags issued
        // back to back all see an empty `confirmed`, so a commit-time snapshot
        // would record the original server row three times and undo would jump
        // straight past two landed writes. At settle time `state.confirmed` is
        // exactly what the database held immediately before this write.
        const previous = state.confirmed[write.zoneId] ?? write.previous;
        // An undo's success consumes the entry it popped when issued. Any other
        // write becomes undoable.
        const history = write.isUndo
          ? state.history
          : [...state.history, { zoneId: write.zoneId, previous }].slice(-HISTORY_LIMIT);
        return { ...state, inFlight, draft, confirmed, settledSeq, history };
      }

      const draft = { ...state.draft };
      // ⚠️ The draft is DROPPED on failure, never re-pointed at `confirmed`.
      // Pinning it to the last known value is rule ④'s defect relocated to the
      // failure path: the zone would then ignore every later server row — a
      // second manager's move, a list-driven reshape, a `router.refresh` — for
      // the component's lifetime, on the one surface that would have shown it.
      // Dropping it hands the zone back to whatever the server last rendered,
      // which is the same thing `confirmed` was standing in for.
      if (!stillPending) delete draft[write.zoneId];
      // Rule ②: a refused undo gives its entry BACK. It must not also pop one.
      const history = write.isUndo
        ? [...state.history, { zoneId: write.zoneId, previous: write.next }].slice(-HISTORY_LIMIT)
        : state.history;
      return { ...state, inFlight, draft, history };
    }

    case "undo": {
      const entry = state.history.at(-1);
      if (!entry) return state;
      // The undo is itself a write: it can be refused like any other, and until
      // it settles the zone shows the restored geometry.
      const previous = state.confirmed[entry.zoneId] ?? entry.previous;
      const popped: CanvasState = { ...state, history: state.history.slice(0, -1) };
      return issue(popped, entry.zoneId, previous, entry.previous, true);
    }
  }
}
