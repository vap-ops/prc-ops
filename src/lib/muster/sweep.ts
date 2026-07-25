// Spec 359 U1 — the continuous-sweep reducer. The add sheet stays open across
// decodes, so the SA needs per-scan feedback without the board round-tripping.
// Everything decidable is decided HERE, as pure functions over board state:
//
//  - outcomes are classified from the board, NOT by parsing the RPC's Thai error
//    strings (scanErrorToThai is presentation; matching on it would couple the
//    sweep to copy),
//  - the cooldown exists because the decode loop fires every ~180ms and a badge
//    stays in frame while the SA moves on — one badge would otherwise fire ~5
//    writes/second. muster_scan_in is idempotent so there is no data damage, but
//    the tally would flood and it burns network on a site connection.
//
// Client-safe by construction: no React, no I/O, and NOTHING server-only (a
// server-only import reaching the "use client" cockpit typechecks green and
// fails `next build` — the #742 lesson).

/** How long the same badge payload is ignored after a scan. */
export const SCAN_COOLDOWN_MS = 3000;

export type SweepOutcomeKind =
  /** Added; their last muster was this same lead. */
  | "added"
  /** Added, but their last muster was a DIFFERENT lead — warn, never block. */
  | "added_team_changed"
  /** Added; no prior muster on record. */
  | "added_first_time"
  /** Already on this team (board or earlier in this sweep). No write. */
  | "already_here"
  /** Mustered on another team today. No write; offer ย้าย after the sweep. */
  | "other_team"
  /** Payload is not a worker on the active roster. */
  | "unknown_badge"
  /** The write was attempted and the server refused. */
  | "failed";

export interface SweepEntry {
  /** Monotonic within a sweep; React key. */
  seq: number;
  workerId: string;
  /** Resolved display name, or the raw payload for an unknown badge. */
  name: string;
  outcome: SweepOutcomeKind;
  /** Prior lead / other team's lead / error message. Null when there is nothing to add. */
  detail: string | null;
}

export interface SweepState {
  /** Newest first. */
  entries: SweepEntry[];
  /** Workers this sweep has successfully queued a write for. */
  addedIds: string[];
  /** workerId → epoch ms of the last accepted decode, for the cooldown. */
  lastSeen: Record<string, number>;
  seq: number;
}

export const EMPTY_SWEEP: SweepState = { entries: [], addedIds: [], lastSeen: {}, seq: 0 };

export interface SweepContext {
  /** The team whose sheet is open. */
  teamId: string;
  /** This team's LEAD WORKER id — the team-change comparison keys on this, not
   *  on the display name: surnames repeat across this roster (three แสงทอง on
   *  PRC-2026-004 alone) and a name collision would silently suppress a warning. */
  leadWorkerId: string;
  /** Active roster: worker id → display name. */
  workersById: ReadonlyMap<string, string>;
  /** Worker id → the team they are already on TODAY, from the board. */
  todayTeamByWorker: ReadonlyMap<string, string>;
  /** Team id → lead name, so another team can be named. */
  teamLeadById: ReadonlyMap<string, string>;
  /** Worker id → the lead of their LAST PRIOR muster. Absent = never mustered.
   *  Carries both id (for the comparison) and name (for the tally copy). */
  priorLeadByWorker: ReadonlyMap<string, { id: string; name: string }>;
  /** Added earlier in this same sweep (the board is stale until the sheet closes). */
  addedThisSweep: ReadonlySet<string>;
}

export interface ClassifiedScan {
  workerId: string;
  name: string;
  kind: SweepOutcomeKind;
  detail: string | null;
  /** True only when a muster_scan_in call should follow. */
  shouldWrite: boolean;
}

export function isCoolingDown(state: SweepState, workerId: string, nowMs: number): boolean {
  const last = state.lastSeen[workerId];
  return last !== undefined && nowMs - last < SCAN_COOLDOWN_MS;
}

export function classifyScan(ctx: SweepContext, workerId: string): ClassifiedScan {
  const name = ctx.workersById.get(workerId);
  if (name === undefined) {
    return { workerId, name: workerId, kind: "unknown_badge", detail: null, shouldWrite: false };
  }
  // The board is only refreshed when the sheet closes, so a worker added earlier
  // in THIS sweep is not yet in todayTeamByWorker — check both.
  if (ctx.addedThisSweep.has(workerId)) {
    return { workerId, name, kind: "already_here", detail: null, shouldWrite: false };
  }
  const todayTeam = ctx.todayTeamByWorker.get(workerId);
  if (todayTeam !== undefined) {
    if (todayTeam === ctx.teamId) {
      return { workerId, name, kind: "already_here", detail: null, shouldWrite: false };
    }
    return {
      workerId,
      name,
      kind: "other_team",
      detail: ctx.teamLeadById.get(todayTeam) ?? null,
      shouldWrite: false,
    };
  }
  const priorLead = ctx.priorLeadByWorker.get(workerId);
  if (priorLead === undefined) {
    return { workerId, name, kind: "added_first_time", detail: null, shouldWrite: true };
  }
  if (priorLead.id !== ctx.leadWorkerId) {
    return {
      workerId,
      name,
      kind: "added_team_changed",
      detail: priorLead.name,
      shouldWrite: true,
    };
  }
  return { workerId, name, kind: "added", detail: null, shouldWrite: true };
}

export function recordScan(state: SweepState, c: ClassifiedScan, nowMs: number): SweepState {
  const seq = state.seq + 1;
  return {
    entries: [
      { seq, workerId: c.workerId, name: c.name, outcome: c.kind, detail: c.detail },
      ...state.entries,
    ],
    addedIds: c.shouldWrite ? [...state.addedIds, c.workerId] : state.addedIds,
    lastSeen: { ...state.lastSeen, [c.workerId]: nowMs },
    seq,
  };
}

// Spec 359 U1 — the SA resolved an other-team row by moving that worker onto
// this team after the sweep. The entry becomes a plain add so the count and the
// copy agree.
export function markMoved(state: SweepState, workerId: string): SweepState {
  const idx = state.entries.findIndex((e) => e.workerId === workerId);
  if (idx === -1) return state;
  return {
    ...state,
    entries: state.entries.map((e, i) =>
      i === idx ? { ...e, outcome: "added" as const, detail: null } : e,
    ),
    addedIds: state.addedIds.includes(workerId) ? state.addedIds : [...state.addedIds, workerId],
  };
}

export function markFailed(state: SweepState, workerId: string, error: string): SweepState {
  const idx = state.entries.findIndex((e) => e.workerId === workerId);
  if (idx === -1) return state;
  const entries = state.entries.map((e, i) =>
    i === idx ? { ...e, outcome: "failed" as const, detail: error } : e,
  );
  return {
    ...state,
    entries,
    addedIds: state.addedIds.filter((id) => id !== workerId),
  };
}
