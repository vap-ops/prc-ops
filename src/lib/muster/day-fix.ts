// Spec 400 U6a — the worker-day fix screen's pure decisions.
//
// PURE and exported, per the U1 lesson: a source scan can prove a branch
// EXISTS, never that it is REACHABLE (`if (canOpenCalendar)` -> `if (true)`
// stayed green with the whole suite passing), so every arm that decides what
// the page offers is driven directly in its own test rather than inferred from
// the page's JSX.

import { isValidUuid } from "@/lib/validate/uuid";
import { isValidIsoDate } from "@/lib/muster/attendance-audit";
import type { GridDay } from "@/lib/muster/attendance-grid";

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
 * Spec 400 U6b — the ONE builder for every link INTO this page.
 *
 * Deliberately in the same module as `parseFixParams`, which reads this URL: the
 * writer and the reader of a param contract drift the moment they live apart,
 * and three surfaces (the grid, the ?day= panel, the spec-374 calendar) now mint
 * this href. A round-trip test over the pair is one assertion here instead of
 * three copies of `new URLSearchParams` in three components.
 *
 * `project` is OMITTED rather than emptied when absent: `parseFixParams` fails
 * the whole parse on a malformed project and `""` is not a uuid, so `?project=`
 * would turn a working link into a dead one. Leaving it out is correct wherever
 * a session exists — the page falls back to `sessions[0].projectId`.
 */
export function fixHref(opts: {
  workerId: string;
  date: string;
  projectId: string | null;
  /** Where this page's back chip should return to — the caller's own URL. */
  backHref: string;
}): string {
  const q = new URLSearchParams({ worker: opts.workerId, date: opts.date });
  if (opts.projectId) q.set("project", opts.projectId);
  // `?from=` is threaded even when it is /team: this page is multi-parent and
  // `safeBackHref` resolves the fallback, so an explicit referrer is what makes
  // the back chip return to the SURFACE the reader actually came from.
  q.set("from", opts.backHref);
  return `/team/attendance/fix?${q.toString()}`;
}

/**
 * Spec 400 U6b — whether a GRID cell becomes a link to the fix screen.
 *
 * Two doors, and they have different preconditions because the RPCs do:
 *
 *  - a cell WITH a session is a retime/delete target. `muster_correct_session`'s
 *    UPDATE path works on a CLOSED day (its guard is the unbooked-wage anti-join,
 *    built for the nine 2026-07-24 OT rows), and the project can always be
 *    inferred from the session, so neither closure nor `?project=` gates it. Only
 *    cells carrying a FINDING link: a clean session is not a hole, and 546 tap
 *    targets would bury the ones that are. A clean day is still reachable
 *    per-worker through the spec-374 calendar, whose grain is one worker.
 *  - an EMPTY cell is an add target, and `muster_correct_session`'s INSERT path
 *    needs a team, a project and an open day. With no session there is nothing to
 *    infer the project FROM, so `canFixGaps` (a project is picked) is required or
 *    the page renders `noProject` and offers nothing. A non-working day is
 *    excluded because an empty Sunday is not a finding — the shading rule exists
 *    to stop it reading as one, and a tap target on 41 of them re-creates that.
 *    `headcount === 0` is excluded because no team exists to add anyone to.
 */
export function gridCellFixable(opts: {
  hasSession: boolean;
  hasFindings: boolean;
  day: Pick<GridDay, "nonWorking" | "headcount">;
  /** A project is picked, so the fix page can resolve one without a session. */
  canFixGaps: boolean;
}): boolean {
  if (opts.hasSession) return opts.hasFindings;
  return opts.canFixGaps && !opts.day.nonWorking && opts.day.headcount > 0;
}

/**
 * Spec 400 U6b — the days whose correction loop is UNFINISHED: attendance was
 * recorded, the day is over, and nobody closed it.
 *
 * All three conditions are load-bearing, and the two exclusions are the same
 * cry-wolf line the U1 review drew at the column header:
 *
 *  - `dayClosed === false` alone is the NORMAL state of the current day, and the
 *    default range always includes today, so keying on it would paint the banner
 *    amber every single day forever.
 *  - `dayClosed === null` (no attendance rows at all) is a THIRD state and must
 *    not collapse into `false`. Live, 2026-08-06 carries zero rows; calling it
 *    unfinished would invent a correction nobody owes.
 *
 * ⚠️ NAMED FOR WHAT IT DETECTS, not for what prompted it. A day that was reopened
 * and never re-closed is in this set, but so is one nobody ever closed — the grid
 * carries no reopen history, so copy calling this "reopened" would assert what
 * the data cannot support. Both states need the same act (ปิดวัน), which is why
 * one predicate is honest here.
 *
 * Measured 2026-08-07: 13 past days carry attendance and ALL 13 are closed, so
 * this returns `[]` against today's production data — an exception signal, not
 * wallpaper.
 */
export function unfinishedDays(days: readonly GridDay[], todayIso: string): GridDay[] {
  return days.filter((d) => d.dayClosed === false && d.date < todayIso);
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
