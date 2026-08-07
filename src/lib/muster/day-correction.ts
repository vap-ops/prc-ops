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
  if (date > todayIso) return { control: "none", reason: "future" };
  if (dayClosed === null) return { control: "none", reason: "noRecords" };
  // Today's OPEN day is withheld from the close arm only — a closed today can
  // still be reopened from here, which is the whole point of the reopen path.
  if (dayClosed === false && date >= todayIso) return { control: "none", reason: "dayNotOver" };

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
