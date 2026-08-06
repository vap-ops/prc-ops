// Spec 400 U3b — the ?day= panel: the COLUMN twin of the ?worker= drill.
//
// U1 made the grid the default view, and every correction control the app had
// lived inside the LIST's drill — so the default view of the audit report showed
// procurement each hole and offered them nothing. Closure is a PROJECT-DAY fact
// (the grid's own doctrine puts headcount and closure on the column, never on 41
// cells), so its controls belong on the column too.
//
// Presentational only: no fetching, no client hooks, no 'use client'. The page is
// zero-client-JS and both controls are plain POST forms + a redirect, so they
// work on the in-app browser where hydration does not run.
//
// The state machine is NOT here. dayCorrectionControl is a pure exported function
// because U1 proved a source scan cannot see reachability — `if (x)` → `if (true)`
// left the suite green — so every arm is driven directly in its own test.

import { closeMusterDayFromForm } from "@/app/team/attendance/actions";
import { MusterReopenForm } from "@/components/features/muster/muster-reopen-form";
import { formatThaiDate } from "@/lib/i18n/labels";
import { dayClosureLabel } from "@/lib/muster/attendance-audit";
import type { GridDay } from "@/lib/muster/attendance-grid";
import { dayCorrectionControl } from "@/lib/muster/day-correction";
import { BUTTON_SECONDARY, CARD } from "@/lib/ui/classes";

/** The copy for every arm that offers nothing. `notPermitted` is deliberately
 *  silent: spec 397 U3's rule is that withholding the CONTROL must not withhold
 *  the FACT, and it does not license telling a reader off either — the header
 *  above still states the day's closure and headcount. */
const NO_CONTROL_COPY: Record<string, string | null> = {
  future: "วันนี้ยังมาไม่ถึง",
  noRecords: "ยังไม่มีบันทึกการเช็คชื่อในวันนี้",
  noProject: "เลือกโครงการก่อน จึงจะปิดหรือเปิดวันนี้ได้",
  notPermitted: null,
};

export function AttendanceDayPanel({
  day,
  todayIso,
  projectId,
  canReopen,
  canClose,
  returnTo,
}: {
  day: GridDay;
  todayIso: string;
  /** The picked project, or null for ทุกโครงการ — both RPCs take exactly one. */
  projectId: string | null;
  /** MUSTER_REOPEN_ROLES.includes(role) — resolved by the page. */
  canReopen: boolean;
  /** MUSTER_CLOSE_ROLES.includes(role) — resolved by the page. */
  canClose: boolean;
  /** The caller's current URL; the redirect appends the outcome to it. */
  returnTo: string;
}) {
  const state = dayCorrectionControl({
    date: day.date,
    todayIso,
    dayClosed: day.dayClosed,
    projectId,
    canReopen,
    canClose,
  });

  return (
    <section
      id={`d-${day.date}`}
      aria-label={`แก้ไขวัน ${formatThaiDate(day.date)}`}
      className={`${CARD} mt-4`}
    >
      {/* The FACTS first, and unconditionally. A day with no rows says so rather
          than reading as "open", the same split GridDay.dayClosed === null makes. */}
      <p className="text-ink text-sm font-semibold">
        {formatThaiDate(day.date)}
        {day.dayClosed === null
          ? " · ยังไม่มีบันทึกการเช็คชื่อ"
          : ` · ${dayClosureLabel({ workDate: day.date, dayClosed: day.dayClosed }, todayIso)}`}
      </p>
      <p className="text-ink-secondary mt-0.5 text-xs">
        {day.headcount} คน
        {day.holidayName !== null ? ` · ${day.holidayName}` : day.nonWorking ? " · วันหยุด" : ""}
      </p>

      {state.control === "reopen" && projectId !== null && (
        <MusterReopenForm
          projectId={projectId}
          workDate={day.date}
          returnTo={returnTo}
          canClose={canClose}
        />
      )}

      {state.control === "close" && projectId !== null && (
        <form
          action={closeMusterDayFromForm}
          aria-label={`ปิดวัน ${formatThaiDate(day.date)}`}
          className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="workDate" value={day.date} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit" className={`${BUTTON_SECONDARY} shrink-0`}>
            ปิดวัน
          </button>
          {/* Closing is not a bookkeeping tick: close_muster_day auto-checks-out
              the open regular sessions and calls the labour derive, so it is the
              step that books the day's wages. A reader who does not know that
              cannot judge whether to press it. */}
          <p className="text-ink-secondary basis-full text-[11px]">
            ปิดวันแล้วระบบจะคิดค่าแรงของวันนั้น และแก้ไขการเช็คชื่อไม่ได้จนกว่าจะเปิดวันอีกครั้ง
          </p>
        </form>
      )}

      {state.control === "none" && NO_CONTROL_COPY[state.reason] !== null && (
        <p className="text-ink-secondary mt-2 text-xs">{NO_CONTROL_COPY[state.reason]}</p>
      )}
    </section>
  );
}
