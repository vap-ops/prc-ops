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

/** Spec 359 U4 — which muster event a sweep is recording. The session/direction
 *  pair is the SA's VISIBLE choice (the cockpit toggles), never derived from the
 *  worker's state — deriving it is what let one worker's OT be closed by his own
 *  second scan on 2026-07-26. */
export interface SweepAction {
  session: "regular" | "ot";
  direction: "in" | "out";
}

/** Spec 359 U4 — a worker's muster state today, wherever they are. Only
 *  `regular` + `in` CREATES membership; every other direction reads it, so the
 *  team comes from here rather than from an SA picking one. */
export interface WorkerSession {
  teamId: string;
  /** The regular session's check-out, if it has happened. */
  outAt: string | null;
  ot: { inAt: string | null; outAt: string | null } | null;
}

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
  | "failed"
  // ---- Spec 359 U4, the resolved directions ----------------------------------
  /** Regular session closed by this scan. */
  | "checked_out"
  /** Their check-out already happened. NO write — `muster_scan_out` would
   *  overwrite `out_at` with now(), replacing a real time with this scan's. */
  | "already_out"
  /** No session on today's board, so there is nothing to close or extend. */
  | "not_checked_in"
  /** OT session opened by this scan. */
  | "ot_opened"
  /** OT is already running. No write (an OT-in here would be a no-op anyway). */
  | "ot_already_open"
  /** That OT is closed, and there is only one OT session per worker per day —
   *  neither direction can do anything, and nothing in the app reopens it. */
  | "ot_already_closed"
  /** OT session closed by this scan — this is the timestamp `ot_hours` prices. */
  | "ot_closed"
  /** OT check-out for a worker who never opened OT. */
  | "no_ot";

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
  /** The team whose sheet is open — null for the resolved directions, which have
   *  no team to open (spec 359 U4: "checking out require no team picking"). */
  teamId: string | null;
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
  /** Spec 359 U4 — worker id → their session today, across EVERY team on the
   *  board. The resolved directions write against `teamId` from here, so the SA
   *  walks the site with one open scanner instead of picking a team per man. */
  sessionByWorker: ReadonlyMap<string, WorkerSession>;
}

export interface ClassifiedScan {
  workerId: string;
  name: string;
  kind: SweepOutcomeKind;
  detail: string | null;
  /** True only when a muster scan call should follow. */
  shouldWrite: boolean;
  /** Spec 359 U4 — the team the write must name: the chosen team for the morning
   *  line, the worker's OWN team for every resolved direction. Null when there is
   *  nothing to write. */
  teamId: string | null;
}

export function isCoolingDown(state: SweepState, workerId: string, nowMs: number): boolean {
  const last = state.lastSeen[workerId];
  return last !== undefined && nowMs - last < SCAN_COOLDOWN_MS;
}

export function classifyScan(
  ctx: SweepContext,
  workerId: string,
  action: SweepAction,
): ClassifiedScan {
  const name = ctx.workersById.get(workerId);
  if (name === undefined) {
    return {
      workerId,
      name: workerId,
      kind: "unknown_badge",
      detail: null,
      shouldWrite: false,
      teamId: null,
    };
  }
  // Spec 359 U4 — every direction except the morning line READS a membership that
  // already exists, so it resolves the team instead of being handed one. The
  // action is required (never defaulted) because a direction-sensitive decision
  // taken silently is the 2026-07-26 OT defect.
  if (action.session === "ot" || action.direction === "out") {
    return classifyResolved(ctx, workerId, name, action);
  }
  // The board is only refreshed when the sheet closes, so a worker added earlier
  // in THIS sweep is not yet in todayTeamByWorker — check both.
  if (ctx.addedThisSweep.has(workerId)) {
    return {
      workerId,
      name,
      kind: "already_here",
      detail: null,
      shouldWrite: false,
      teamId: null,
    };
  }
  const todayTeam = ctx.todayTeamByWorker.get(workerId);
  if (todayTeam !== undefined) {
    if (todayTeam === ctx.teamId) {
      return {
        workerId,
        name,
        kind: "already_here",
        detail: null,
        shouldWrite: false,
        teamId: null,
      };
    }
    return {
      workerId,
      name,
      kind: "other_team",
      detail: ctx.teamLeadById.get(todayTeam) ?? null,
      shouldWrite: false,
      teamId: null,
    };
  }
  const priorLead = ctx.priorLeadByWorker.get(workerId);
  if (priorLead === undefined) {
    return {
      workerId,
      name,
      kind: "added_first_time",
      detail: null,
      shouldWrite: true,
      teamId: ctx.teamId,
    };
  }
  if (priorLead.id !== ctx.leadWorkerId) {
    return {
      workerId,
      name,
      kind: "added_team_changed",
      detail: priorLead.name,
      shouldWrite: true,
      teamId: ctx.teamId,
    };
  }
  return { workerId, name, kind: "added", detail: null, shouldWrite: true, teamId: ctx.teamId };
}

// Spec 359 U4 — check-out, OT-in and OT-out. Each writes against the worker's own
// team, and each refuses rather than repeat a write that would DESTROY a value:
// `muster_scan_out` overwrites `out_at` with now() (no already-out guard), and a
// closed OT carries the `ot_hours` its span priced and can never be reopened.
function classifyResolved(
  ctx: SweepContext,
  workerId: string,
  name: string,
  action: SweepAction,
): ClassifiedScan {
  const session = ctx.sessionByWorker.get(workerId);
  const refuse = (kind: SweepOutcomeKind, detail: string | null = null): ClassifiedScan => ({
    workerId,
    name,
    kind,
    detail,
    shouldWrite: false,
    teamId: null,
  });
  if (session === undefined) {
    return refuse("not_checked_in");
  }
  const lead = ctx.teamLeadById.get(session.teamId) ?? null;
  const write = (kind: SweepOutcomeKind): ClassifiedScan => ({
    workerId,
    name,
    kind,
    // Name the team the write landed on — a team-agnostic sweep must still be
    // auditable at a glance, since the SA never chose one.
    detail: lead,
    shouldWrite: true,
    teamId: session.teamId,
  });
  // Written earlier in THIS sweep. The board does not know yet — it refreshes when
  // the sheet closes — so without this a re-scan on a walk-round would repeat a
  // write the SA already made, and for `out` that means overwriting a real time.
  //
  // A sweep carries exactly ONE action: the session/direction toggles sit on the
  // page BEHIND the sheet (`fixed inset-0`, aria-modal), so changing round means
  // closing the sheet, and closing RESETS the sweep. `writtenHere` therefore means
  // "this same event was already written for this worker", and each round answers
  // with its own "already" outcome. (A reviewer read the earlier form as blocking
  // OT-in → OT-out inside one sweep; that sequence cannot be reached, and if it
  // ever became reachable, refusing a ten-second OT is the correct answer — that
  // is the 2026-07-26 field defect, whose `ot_hours` came out NULL.)
  if (ctx.addedThisSweep.has(workerId)) {
    return refuse(
      action.session === "regular"
        ? "already_out"
        : action.direction === "in"
          ? "ot_already_open"
          : "ot_already_closed",
      lead,
    );
  }

  if (action.session === "regular") {
    if (session.outAt !== null) return refuse("already_out", lead);
    return write("checked_out");
  }
  if (session.ot?.outAt != null) return refuse("ot_already_closed", lead);
  if (action.direction === "in") {
    if (session.ot !== null) return refuse("ot_already_open", lead);
    return write("ot_opened");
  }
  if (session.ot === null) return refuse("no_ot", lead);
  return write("ot_closed");
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
