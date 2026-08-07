// Spec 400 U6a — the worker-day fix screen's pure decisions.
//
// PURE and exported, per the U1 lesson: a source scan can prove a branch
// EXISTS, never that it is REACHABLE (`if (canOpenCalendar)` -> `if (true)`
// stayed green with the whole suite passing), so every arm that decides what
// the page offers is driven directly in its own test rather than inferred from
// the page's JSX.

import { isValidUuid } from "@/lib/validate/uuid";
import { isValidIsoDate } from "@/lib/muster/attendance-audit";

type Param = string | string[] | undefined;

function one(value: Param): string | undefined {
  // A repeated key (?worker=a&worker=b) arrives as an array — treat it as
  // absent rather than silently picking one (the spec-337 repeated-key lesson,
  // the same rule attendance-audit.ts's own `one()` applies).
  return typeof value === "string" ? value : undefined;
}

export type FixParams = { workerId: string; date: string; projectId: string | null };

/**
 * `?worker=&date=&project=` -> the identity this page is fixing, or `null` when
 * the link cannot be trusted. Unlike `attendanceRange`'s per-field fallback
 * (a report degrades gracefully to a default range), worker and date are the
 * whole reason this page exists — there is no sensible default for either, so
 * either one being missing or malformed fails the WHOLE parse.
 */
export function parseFixParams(input: {
  worker?: Param;
  date?: Param;
  project?: Param;
}): FixParams | null {
  const worker = one(input.worker);
  const date = one(input.date);
  const project = one(input.project);

  if (!worker || !isValidUuid(worker)) return null;
  if (!date || !isValidIsoDate(date)) return null;
  if (project !== undefined && !isValidUuid(project)) return null;

  return { workerId: worker, date, projectId: project ?? null };
}

/**
 * The next calendar date, as `YYYY-MM-DD`.
 *
 * Built through UTC on purpose: the input is a bare CALENDAR date with no zone,
 * and `new Date("2026-08-04")` is parsed as UTC midnight, so adding a day in UTC
 * and re-slicing is exact. Constructing it in LOCAL time would shift the result
 * by a day on any machine west of UTC — and this box, Vercel and CI all run UTC
 * while the app's dates are Bangkok, which is precisely the mismatch
 * `bangkokInAt` exists to make explicit.
 */
export function nextIsoDate(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether an existing session's recorded check-out can be replaced by a
 * retime. `muster_correct_session` refuses to touch `out_at` once a HUMAN
 * recorded it (`out_auto === false`) — a fabricated auto-out may be replaced,
 * a recorded one may not (spec 400 U4 fork 4, "a recorded check-out cannot be
 * replaced"). The IN field is never locked by this rule.
 */
export function outTimeLocked(session: { outAt: string | null; outAuto: boolean }): boolean {
  return session.outAt !== null && !session.outAuto;
}

/**
 * Whether the ADD arm applies at all. `muster_correct_session`'s insert path
 * may only ever create a REGULAR session — an OT one is x1.5 money (spec 351)
 * and creating one after the fact was never part of the correction ruling — so
 * a worker who already has a regular session has nothing to add: offering the
 * control would just reach the RPC's own "already mustered" refusal.
 */
export function canAddMissingSession(sessions: readonly { session: "regular" | "ot" }[]): boolean {
  return !sessions.some((s) => s.session === "regular");
}

// ⚠️ There is deliberately NO `undoSessionControl` here. One was written,
// exported and tested — and the page inlined `dayClosed === false` anyway, so
// the tested arm was never the arm that ran: a decision function nothing calls,
// reading as coverage while covering nothing. Deleting a session is gated on
// exactly "the day is open" (`muster_undo_scan` refuses a closure outright),
// which the page's own locked-group block already expresses and
// `attendance-fix-page.test.ts` pins by SITE rather than by symbol. Re-adding a
// helper here would restore the ceremony without restoring the coverage.
