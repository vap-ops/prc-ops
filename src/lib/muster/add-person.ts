// Spec 400 U3c-b — "he was here, add him": which arm the ?day= panel may offer,
// and the timestamp the correction carries.
//
// PURE and exported because the branch IS the unit — U1 shipped that lesson on
// this very page: a source scan proves a branch EXISTS, never that it is
// REACHABLE, and mutating `if (canOpenCalendar)` to `if (true)` left the whole
// suite green. So every arm is driven directly in its own test and the panel
// renders only the answer.
//
// The order of the arms is the honest-copy rule made structural. `future` is a
// fact about the day and true for every reader, so it comes first. PERMISSION
// comes next and renders NOTHING — withholding a control must not turn into
// telling a reader off (spec 397 U3). Only then do the two arms whose copy tells
// the reader to DO something (pick a project, reopen the day), because an
// instruction handed to someone who could never act on it is the
// affordance-that-is-not-there defect one layer down.

import { ISO_DATE_REGEX } from "@/lib/dates";

/** What the panel may offer for adding a missed person to one project-day. */
export type AddPersonControl =
  | { control: "add" }
  | {
      control: "none";
      reason:
        /** The date has not happened yet — nobody was there to miss. */
        | "future"
        /** Outside MUSTER_CORRECT_ROLES. Renders NO message. */
        | "notPermitted"
        /** `muster_correct_session` takes one team, which belongs to one project. */
        | "noProject"
        /**
         * The day is closed. `muster_correct_session` refuses the INSERT path on
         * a closed day by design (U3a's rule, unchanged) — reopen first, which
         * every member of this audience can do (MUSTER_CORRECT_ROLES ⊆
         * MUSTER_REOPEN_ROLES, pinned).
         */
        | "closed"
        /**
         * The day has no team to add anyone TO. Without this arm the picker
         * renders empty and the RPC refuses with `team not found` AFTER the tap —
         * the message migration 20260813075912's own comment predicted.
         */
        | "noTeams";
    };

export function addPersonControl(input: {
  date: string;
  todayIso: string;
  /** `GridDay.dayClosed` — `null` means the day carries no attendance rows. */
  dayClosed: boolean | null;
  /** `AttendanceRange.projectId`, or null for ทุกโครงการ. */
  projectId: string | null;
  /** MUSTER_CORRECT_ROLES.includes(role) — resolved by the page. */
  canCorrect: boolean;
  /** Rows from `list_muster_teams_for_day` for this project-day. */
  teamCount: number;
}): AddPersonControl {
  const { date, todayIso, dayClosed, projectId, canCorrect, teamCount } = input;

  if (date > todayIso) return { control: "none", reason: "future" };
  if (!canCorrect) return { control: "none", reason: "notPermitted" };
  if (projectId === null) return { control: "none", reason: "noProject" };
  // `=== true` and not truthiness: `null` means the day has no attendance rows at
  // all, which is the HOLE this control exists for (08-04 mustered one person),
  // not a closed day. dayCorrectionControl treats null as "nothing to close" —
  // the opposite reading, correct there and wrong here.
  if (dayClosed === true) return { control: "none", reason: "closed" };
  if (teamCount === 0) return { control: "none", reason: "noTeams" };

  return { control: "add" };
}

/** `HH:MM`, 24-hour, both parts in range. `<input type="time">` emits this. */
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Build the `in_at` the RPC receives, with the Bangkok offset stated EXPLICITLY.
 *
 * ⚠️ The offset is the whole point. `muster_correct_session` bounds `in_at` to
 * `(p_in_at at time zone 'Asia/Bangkok')::date = work_date`, so a bare
 * `2026-08-04T08:00:00` is parsed as UTC, lands at 15:00 Bangkok — still the same
 * date here, but 00:30 becomes the PREVIOUS day and is refused. Constructing the
 * instant on the server from a Date would be worse: this box, Vercel and CI all
 * run UTC, so the "obvious" local-time construction is wrong everywhere the code
 * actually runs and right only on a developer machine set to Bangkok.
 *
 * Returns null rather than guessing: the form's inputs are `required` and typed,
 * so a malformed value here means a hand-posted body, and the action turns null
 * into its `shape` refusal.
 */
export function bangkokInAt(dateIso: string, timeHhmm: string): string | null {
  if (!ISO_DATE_REGEX.test(dateIso)) return null;
  if (!TIME_REGEX.test(timeHhmm)) return null;
  return `${dateIso}T${timeHhmm}:00+07:00`;
}
