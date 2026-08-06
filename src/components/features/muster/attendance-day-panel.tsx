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
//
// ⚠️ CLOSING IS THE MONEY STEP AND IT LOSES TWO THINGS. `close_muster_day` stamps
// `out_at = greatest(17:00, in_at)` on every open REGULAR session (a check-out
// nobody recorded) and leaves every open OT session alone — and no RPC can record
// a past check-out for any role, so an OT session left open is unbookable. The
// cockpit and the prior-day banner both disclose exactly that before their own
// close, behind a second deliberate act. This panel does the same rather than
// re-shipping, for PAST days and for a role that has never closed a day, the
// one-tap loss those two surfaces exist to prevent.

import { closeMusterDayFromForm } from "@/app/team/attendance/actions";
import { MusterReopenForm } from "@/components/features/muster/muster-reopen-form";
import { ErrorNotice } from "@/components/features/common/notices";
import { USER_ROLE_LABEL, formatThaiDate, formatThaiTime } from "@/lib/i18n/labels";
import { dayClosureLabel } from "@/lib/muster/attendance-audit";
import type { GridDay } from "@/lib/muster/attendance-grid";
import { describeAuditEvent, type DayAuditRow } from "@/lib/muster/day-audit";
import { dayCorrectionControl, type DayCorrectionControl } from "@/lib/muster/day-correction";
import { BUTTON_SECONDARY, CARD } from "@/lib/ui/classes";

/** The copy for every arm that offers nothing.
 *
 *  `notPermitted` is deliberately silent: spec 397 U3's rule is that withholding
 *  the CONTROL must not withhold the FACT, and it does not license telling a
 *  reader off either — the header above still states closure and headcount.
 *
 *  ⚠️ Keyed on the reason UNION, not `string`: a fifth arm must red at typecheck
 *  rather than render an empty paragraph. And none of them says วันนี้ — the panel
 *  is usually open on a PAST column, where "today" is a claim about the wrong day.
 */
const NO_CONTROL_COPY: Record<
  Extract<DayCorrectionControl, { control: "none" }>["reason"],
  string | null
> = {
  future: "วันดังกล่าวยังมาไม่ถึง",
  noRecords: "ยังไม่มีบันทึกการเช็คชื่อของวันดังกล่าว",
  dayNotOver: "ยังอยู่ระหว่างวัน ปิดวันได้เมื่อจบวันแล้ว",
  noProject: "เลือกโครงการก่อน จึงจะปิดหรือเปิดวันดังกล่าวได้",
  notPermitted: null,
};

export function AttendanceDayPanel({
  day,
  todayIso,
  projectId,
  canReopen,
  canClose,
  returnTo,
  stillIn = { regular: [], ot: [] },
  outcome = null,
  trail = null,
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
  /**
   * The names, per session kind, of the workers with no check-out on this day —
   * the two things closing costs. Named, not counted, because "3 คน" gives the
   * reader nothing to check against and the cockpit already names them.
   */
  stillIn?: { regular: readonly string[]; ot: readonly string[] };
  /**
   * The close form's outcome, rendered HERE rather than at the top of the page:
   * the redirect anchors on `#d-<date>`, and this panel sits below a table tall
   * enough that a banner in the page header is a viewport away from where the
   * reader lands — a refusal would look like nothing happened.
   */
  outcome?: { ok: true } | { ok: false; message: string } | null;
  /**
   * Spec 400 U5 — every after-the-fact edit to this project-day, newest first,
   * from `list_muster_day_audit`.
   *
   * `null` means NOT FETCHED, and it is a different fact from `[]`. Both RPCs on
   * this panel take exactly one project, so a ทุกโครงการ column reads nothing —
   * and rendering "ยังไม่มีการแก้ไข" there would assert something about days the
   * page never looked at. The controls already make that distinction with their
   * own `noProject` arm; the trail makes it too rather than inheriting silence.
   */
  trail?: readonly DayAuditRow[] | null;
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

      {outcome !== null &&
        (outcome.ok ? (
          <p className="border-edge bg-sunk text-ink rounded-card mt-2 border px-3 py-2 text-xs">
            ปิดวันแล้ว — ระบบคิดค่าแรงของวันดังกล่าวจากการเช็คชื่อล่าสุด
          </p>
        ) : (
          <div className="mt-2">
            <ErrorNotice>{outcome.message}</ErrorNotice>
          </div>
        ))}

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
          className="mt-3 flex flex-col gap-2"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="workDate" value={day.date} />
          <input type="hidden" name="returnTo" value={returnTo} />

          {/* ABOVE the control, because a disclosure a reader meets after the
              button is a disclosure they meet after the tap. */}
          <ul className="text-ink-secondary flex flex-col gap-1 text-[11px]">
            {stillIn.regular.length > 0 && (
              <li>
                {`ช่าง ${stillIn.regular.length} คนยังไม่เช็คออก — ระบบจะบันทึกเวลาออก 17:00 ให้ · ${stillIn.regular.join(", ")}`}
              </li>
            )}
            {stillIn.ot.length > 0 && (
              <li>
                {`ปิดวันจะไม่บันทึก OT ให้ — OT ที่ยังไม่เช็คออก ${stillIn.ot.length} คน · ${stillIn.ot.join(", ")}`}
              </li>
            )}
            <li>ค่าแรงจะบันทึกตามอัตราปัจจุบันของช่าง</li>
            <li>ปิดแล้วแก้ไขการเช็คชื่อไม่ได้จนกว่าจะเปิดวันอีกครั้ง</li>
          </ul>

          {/* The second deliberate act, in the only form this zero-client-JS page
              can carry one: a `required` checkbox. The cockpit arms its own close
              with client state; here the browser enforces it with no hydration. */}
          <label className="text-ink flex min-h-11 items-center gap-2 text-xs">
            <input type="checkbox" name="confirm" required value="1" className="size-4 shrink-0" />
            เข้าใจแล้วว่าปิดวันดังกล่าวจะบันทึกเวลาออกและคิดค่าแรง
          </label>

          <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
            ปิดวัน
          </button>
        </form>
      )}

      {state.control === "none" && NO_CONTROL_COPY[state.reason] !== null && (
        <p className="text-ink-secondary mt-2 text-xs">{NO_CONTROL_COPY[state.reason]}</p>
      )}

      {/* Spec 400 U5 — the trail, BELOW the controls that write it. Shown to the
          whole ATTENDANCE_AUDIT_ROLES audience, which is wider than the roles
          that may correct: accounting owns the wage consequence of a correction,
          so withholding the record from a reader who cannot act would be
          withholding a FACT, not a control (spec 397 U3's rule). */}
      <div className="border-edge mt-4 border-t pt-3">
        <h3 className="text-ink text-xs font-semibold">การแก้ไขย้อนหลัง</h3>
        {trail === null ? (
          <p className="text-ink-secondary mt-1 text-xs">
            เลือกโครงการก่อน จึงจะดูประวัติการแก้ไขได้
          </p>
        ) : trail.length === 0 ? (
          <p className="text-ink-secondary mt-1 text-xs">ยังไม่มีการแก้ไขย้อนหลังของวันดังกล่าว</p>
        ) : (
          <ul aria-label="ประวัติการแก้ไขย้อนหลัง" className="mt-1 flex flex-col gap-2">
            {trail.map((row, i) => {
              const event = describeAuditEvent(row);
              return (
                <li key={`${row.loggedAt}-${i}`} className="text-xs">
                  <p className="text-ink">
                    {formatThaiTime(row.loggedAt)} · {event.action}
                    {row.workerName !== null ? ` · ${row.workerName}` : ""}
                  </p>
                  {event.detail !== null && (
                    <p className="text-ink-secondary mt-0.5">{event.detail}</p>
                  )}
                  {/* An actor with no name is UNATTRIBUTED, never a uuid — the
                      wp-timeline rule. It is the real case: 4 of the 5 live site
                      admins have no name in the system at all. */}
                  <p className="text-ink-secondary mt-0.5">
                    โดย {row.actorName ?? "ไม่ทราบผู้แก้ไข"} ({USER_ROLE_LABEL[row.actorRole]})
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
