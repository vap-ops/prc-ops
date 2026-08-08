// Spec 404 U2 — the attendance calendar's in-page `?fix=` panel: its three pure
// decisions, in one client-safe leaf module.
//
// Spec 400 U7 already extracted `loadWorkerDayFix` + `WorkerDayFixPanel` and
// shipped a URL-driven `?fix=` panel on `/team/attendance` — `<dialog>` was
// explicitly rejected there because it pays the same server round trip and costs
// the page its zero-JS property. This unit ADOPTS that shape; it invents no
// panel. What is new is the AXIS: the grid walks worker-within-day, the calendar
// walks day-within-worker, so the panel needs its own target parse, its own
// project resolution, and its own steppers.
//
// PURE and exported, per the U6a lesson: a source scan proves a branch EXISTS,
// never that it is REACHABLE, and the host is a Server Component vitest cannot
// render. Every arm is driven directly in `attendance-fix-panel.test.ts`.

import { isValidIsoDate } from "@/lib/muster/attendance-audit";
import { isSunday } from "@/lib/muster/attendance-grid";
import { gridCellFixable } from "@/lib/muster/day-fix";

/**
 * Whether the panel opens, and if not, which fact is wrong.
 *
 * `reason: null` is the DEFAULT state and a different thing from a refusal: the
 * panel is closed because nobody asked for it, so nothing is rendered. The two
 * refusals are permanent for that URL — their copy may never say ลองใหม่.
 */
export type CalendarFixTarget =
  | { open: true; date: string }
  | {
      open: false;
      reason:
        /** No `?fix=` at all. Render nothing. */
        | null
        /** Not a real ISO date, or a repeated param. */
        | "shape"
        /** A real date, but not in the month on screen. */
        | "outside";
    };

/**
 * `?fix=` → the day the panel is open on.
 *
 * Default CLOSED. Opening with a panel already showing would force a default
 * target, and "today" is not in the viewed month half the time — the same rule
 * U6a applied to its time fields ("no field ever has a default value"), one
 * level up at the surface.
 *
 * The month bound is the calendar's twin of `attendanceDayParam`, which
 * validates the grid's `?day=` against the columns it actually drew: a panel
 * about a day that is not on screen has no cell to point at, and its steppers
 * would walk a month the reader is not looking at.
 */
export function calendarFixTarget(
  fix: string | string[] | undefined,
  /** YYYY-MM-01, the month being rendered. */
  monthAnchor: string,
): CalendarFixTarget {
  if (fix === undefined) return { open: false, reason: null };
  // A repeated key (?fix=a&fix=b) arrives as an array — treated as malformed
  // rather than silently picking one, the same rule `parseFixParams`' own
  // `one()` applies (the spec-337 repeated-key lesson).
  if (typeof fix !== "string") return { open: false, reason: "shape" };
  if (!isValidIsoDate(fix)) return { open: false, reason: "shape" };
  if (fix.slice(0, 7) !== monthAnchor.slice(0, 7)) return { open: false, reason: "outside" };
  return { open: true, date: fix };
}

/**
 * Which project the panel's writes act on.
 *
 * The DAY owns the project (§2), so a day that carries attendance answers this
 * itself and nothing may override it. An EMPTY day has no session to infer one
 * FROM — and here the calendar can do something the standalone fix screen
 * structurally cannot, because it knows the month's project set (§4.3).
 *
 * ⚠️ It supplies that fallback ONLY when the month is unambiguous. On an empty
 * day of a SPLIT month there are two owners and no evidence, and the add arm
 * books a wage against whichever it is handed — so guessing there would be the
 * summary's "invent an owner" defect with money attached. `null` sends the panel
 * to its permanent-refusal arm instead (§6 case 3).
 */
export function fixPanelProjectId(input: {
  /**
   * The RESOLVED project this panel already settled on, carried by its own
   * `returnTo` across a write. First, and that ordering is the whole point:
   * `/team/attendance/fix` threads the resolved id for the same reason, in its
   * own words — "carrying the param forward would drop the project the moment
   * the last session is deleted — the page would come back with no project,
   * hence no closure, no add form and no trail: a dead end immediately after its
   * only destructive action, with no way to re-add the person just removed."
   *
   * ⚠️ It rides the panel's OWN url only. The day steppers deliberately do not
   * carry it: they move to a different day, which in a split month may belong to
   * a different project, and a stale param would then outrank that day's own.
   */
  paramProjectId: string | null;
  /** The open day's own project id, or null when the day carries no attendance. */
  cellProjectId: string | null;
  /** Distinct project ids the MONTH contains, from its attendance rows. */
  monthProjectIds: readonly string[];
}): string | null {
  if (input.paramProjectId !== null) return input.paramProjectId;
  if (input.cellProjectId !== null) return input.cellProjectId;
  return input.monthProjectIds.length === 1 ? (input.monthProjectIds[0] ?? null) : null;
}

/**
 * Spec 404 U2b — whether a day carrying NO record of this worker becomes a door.
 *
 * Operator ruling 2026-08-08: MIRROR the grid's gap-cell rule, do not invent a
 * second one. A day where this worker has no row but the project scanned others
 * is fully serviceable — `loadWorkerDayFix` offers เพิ่มคนที่ตกหล่น — and until
 * this unit nothing on the page linked it, so the screen built for "the muster
 * missed him" was reachable only by hand-typing a URL. Live in August 2026 that
 * is ONE cell for a worker who missed 08-04, not the ~24 a link-every-blank rule
 * would paint (the cry-wolf line U6b drew at the grid's own gap cells).
 *
 * ⚠️ It DELEGATES to `gridCellFixable` rather than restating its three
 * conditions. Two surfaces that both cite one rule in a comment drift; one that
 * calls it cannot. The mapping is the only thing this function owns:
 *
 *  - `canFixGaps` — the grid means "a project is picked"; here it is "the month
 *    is unambiguous, so `fixPanelProjectId` can supply one". Without it the add
 *    arm would book a wage against a guessed owner (§4.3).
 *  - `headcount` — DISTINCT workers the RESOLVED project scanned that date. It
 *    is stricter than "a team exists", which is what the add path actually
 *    needs, so the error can only ever be a door NOT offered, never one offered
 *    and then refused.
 *  - `nonWorking` — `holiday || Sunday`, NOT the calendar's own `isWeekend`.
 */
export function calendarBlankDayFixable(input: {
  /** The cell's date, inside the rendered month. */
  date: string;
  /** The date's `public_holidays` name, or null. */
  holidayName: string | null;
  /** DISTINCT workers the resolved project scanned that date. */
  projectHeadcount: number;
  /** Whether a project can be resolved for an EMPTY day of this month. */
  projectResolvable: boolean;
}): boolean {
  return gridCellFixable({
    hasSession: false,
    hasFindings: false,
    day: {
      nonWorking: input.holidayName !== null || isSunday(input.date),
      headcount: input.projectHeadcount,
    },
    canFixGaps: input.projectResolvable,
  });
}

/**
 * Where วันก่อนหน้า / วันถัดไป go.
 *
 * They step to the neighbouring DOOR, skipping every other blank: walking a
 * reader through twenty empty cells is the cry-wolf failure U6b already ruled
 * against.
 *
 * `doorDates` is the set of days the calendar actually opens, so the two
 * controls can never disagree about what the month holds. U2b widened that set
 * — a blank day the project scanned others on is now a door
 * (`calendarBlankDayFixable`) — and the steppers followed it for exactly that
 * reason: keeping them on "days that carry attendance" would have broken this
 * invariant the moment a second kind of door existed, and skipped the one day
 * in the month most worth reaching.
 *
 * ⚠️ Order-INDEPENDENT by construction (nearest below / nearest above), not by
 * sorting first. The cells arrive from a `Record`, whose key order is an
 * implementation detail — and the first version DID sort, with a last-one-wins
 * loop underneath. Removing the sort left the suite GREEN, because the fixture's
 * order happened to end on the right answer: the sort was load-bearing and
 * nothing could see it. The property belongs in the comparison, where no input
 * order can satisfy it by luck.
 *
 * `current` need NOT be one of them: a day that is not a door can only be
 * reached by URL, and it still gets the doors on either side of it by date.
 *
 * ⚠️ A stepper can only ever land on a DOOR. Before U2b that meant "never on a
 * day with no record" (an earlier comment claimed the opposite and a fresh-eyes
 * pass measured it); it now means "never on a blank day the project did not
 * scan", which is the same guarantee against the same cry-wolf failure.
 */
export function fixStepDates(
  doorDates: readonly string[],
  current: string,
): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;
  for (const d of doorDates) {
    if (d < current && (prev === null || d > prev)) prev = d;
    if (d > current && (next === null || d < next)) next = d;
  }
  return { prev, next };
}
