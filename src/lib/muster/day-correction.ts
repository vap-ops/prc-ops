// Spec 400 U3b — which correction control a day column may offer, and to whom.
//
// PURE and exported because the branch IS the unit. U1 shipped the lesson: a
// source scan proves a branch exists, never that it is REACHABLE — mutating
// `if (canOpenCalendar)` to `if (true)` left both the code and the role-set count
// untouched and the whole suite green. So the decision lives here, where both
// arms of every input can be driven, and the page/panel only render its answer.
//
// The inputs are two SEPARATE permissions on purpose. `close_muster_day` and
// `reopen_muster_day` are two RPCs with two allowlists; they happen to hold the
// same four roles today (MUSTER_CLOSE_ROLES ⊇ MUSTER_REOPEN_ROLES is pinned), and
// collapsing them into one boolean would make a later narrowing of either one
// invisible here.

/** What the panel may offer for one project-day. */
export type DayCorrectionControl =
  | { control: "reopen" }
  | { control: "close" }
  | {
      control: "none";
      reason:
        /** The date has not happened yet — there is nothing to settle. */
        | "future"
        /** No attendance row at all that day (`GridDay.dayClosed === null`). */
        | "noRecords"
        /**
         * Today, still open. Closing stamps a 17:00 check-out on everyone still
         * in, so mid-shift it fabricates the day's end — and today is the muster
         * COCKPIT's surface, which reaches the same RPC through a ready/overdue
         * state machine this audit report deliberately does not reimplement.
         */
        | "dayNotOver"
        /** The viewer's role is outside the RPC's allowlist. Renders NO message:
         *  withholding the control must not turn into telling a reader off. */
        | "notPermitted"
        /** Both RPCs take one `p_project`; a ทุกโครงการ column spans several. */
        | "noProject";
    };

/**
 * The DAY-level half of the ladder: the facts that are true for every reader,
 * before any permission or project choice can matter.
 *
 * Extracted so `dayCorrectionControl` and `dayClosable` cannot drift — two
 * surfaces disagreeing about the same day is exactly the failure this module's
 * consumers just shipped (see `dayClosable`).
 */
function dayStage(
  date: string,
  todayIso: string,
  dayClosed: boolean | null,
): { ok: true } | { ok: false; reason: "future" | "noRecords" | "dayNotOver" } {
  if (date > todayIso) return { ok: false, reason: "future" };
  if (dayClosed === null) return { ok: false, reason: "noRecords" };
  // Today's OPEN day is withheld from the close arm only — a closed today can
  // still be reopened, which is the whole point of the reopen path.
  if (dayClosed === false && date >= todayIso) return { ok: false, reason: "dayNotOver" };
  return { ok: true };
}

/**
 * Whether an OPEN day may be CLOSED — the same rule as `dayCorrectionControl`'s
 * close arm, asked as a boolean.
 *
 * ⚠️ It exists because `WorkerDayFixPanel` needs this decision and cannot use
 * `dayCorrectionControl`: that function answers reopen XOR close and needs a
 * `canReopen` the panel has no honest value for. `MUSTER_CORRECT_ROLES` (the
 * panel's gate) is a SUBSET of `MUSTER_REOPEN_ROLES`, so any `canReopen` it
 * passed could only ever be `true` — a dead arm dressed up as a decision.
 *
 * 🔴 THE COST OF NOT HAVING THIS: `MusterReopenForm` renders on three surfaces
 * and the close control existed on one, so reopening from the calendar panel or
 * from `/team/attendance/fix` left the day OPEN with no way back. It happened in
 * production — `PRC-2026-004` `2026-08-05`, reopened by procurement and stuck.
 * Both callers now answer from `dayStage`, and a parity test pins them equal.
 */
export function dayClosable(input: {
  date: string;
  todayIso: string;
  /** `null` means the day carries no attendance rows — a third state. */
  dayClosed: boolean | null;
  projectId: string | null;
  /** `MUSTER_CLOSE_ROLES.includes(role)` — close_muster_day's own allowlist. */
  canClose: boolean;
}): boolean {
  const { date, todayIso, dayClosed, projectId, canClose } = input;
  if (!dayStage(date, todayIso, dayClosed).ok) return false;
  // A closed day's control is REOPEN, not close. `=== true` and not `!== false`
  // on purpose: `dayStage` has already rejected `null`, so this arm can only be
  // reached by `true` — the loose form sends the reader hunting for a third
  // state that cannot arrive here.
  if (dayClosed === true) return false;
  return canClose && projectId !== null;
}

export function dayCorrectionControl(input: {
  date: string;
  todayIso: string;
  /** `GridDay.dayClosed` — `null` means the day carries no attendance rows. */
  dayClosed: boolean | null;
  /** `AttendanceRange.projectId`, or null for ทุกโครงการ. */
  projectId: string | null;
  canReopen: boolean;
  canClose: boolean;
}): DayCorrectionControl {
  const { date, todayIso, dayClosed, projectId, canReopen, canClose } = input;

  // Both facts about the DAY come first, because they are true for every reader
  // and neither permission nor a project choice can change them.
  const stage = dayStage(date, todayIso, dayClosed);
  if (!stage.ok) return { control: "none", reason: stage.reason };

  // Permission before the project prompt: "เลือกโครงการก่อน" is only actionable
  // for a reader who could then act. Telling accounting to pick a project would
  // advertise a write its own server refuses.
  const permitted = dayClosed ? canReopen : canClose;
  if (!permitted) return { control: "none", reason: "notPermitted" };
  if (!projectId) return { control: "none", reason: "noProject" };

  return dayClosed ? { control: "reopen" } : { control: "close" };
}

/**
 * `?day=` → the column the panel opens on, validated against the dates the grid
 * ACTUALLY drew. Mirrors `attendanceWorkerId`: an unvalidated value would render
 * a panel describing a column that is not on screen, and a malformed one would
 * reach the RPC as a date-parse error on the error boundary.
 *
 * A repeated key arrives as an array and is treated as absent — the same rule
 * `attendanceRange` and `attendanceView` apply.
 */
export function attendanceDayParam(
  value: string | string[] | undefined,
  dates: readonly string[],
): string | null {
  if (typeof value !== "string") return null;
  return dates.includes(value) ? value : null;
}
