// Spec 400 U7 (§D19) — the worker-day fix SCREEN, rendered by two doors: the
// `/team/attendance/fix` route (U6a, kept because U6b built three doors into it
// and links exist in the wild) and the grid's `?fix=` panel.
//
// Presentational only: no fetching, no client hooks, no 'use client'. Every
// control is a plain POST form + redirect, which is what lets this work on a
// field device whose hydration this repo has watched fail.
//
// The queue strip at the top exists ONLY in the panel — the route has no day
// context to walk — so it is an optional prop rather than a second component.

import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { AttendanceFixAddForm } from "@/components/features/muster/attendance-fix-add-form";
import { AttendanceFixRetimeForm } from "@/components/features/muster/attendance-fix-retime-form";
import { AttendanceFixUndoForm } from "@/components/features/muster/attendance-fix-undo-form";
import { MusterReopenForm } from "@/components/features/muster/muster-reopen-form";
import {
  MUSTER_DAY_CLOSED_LABEL,
  USER_ROLE_LABEL,
  formatThaiDate,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import type { AddPersonControl } from "@/lib/muster/add-person";
import { dayClosureLabel } from "@/lib/muster/attendance-audit";
import { describeAuditEvent } from "@/lib/muster/day-audit";
import { outTimeLocked } from "@/lib/muster/day-fix";
import type { WorkerDayFix } from "@/lib/muster/worker-day-fix";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";

export type FixOutcome = { ok: true } | { ok: false; message: string } | null;

export function WorkerDayFixPanel({
  data,
  workerId,
  date,
  todayIso,
  returnTo,
  canClose,
  outcomes,
  queue = null,
  noProjectHint = null,
}: {
  data: WorkerDayFix;
  workerId: string;
  date: string;
  todayIso: string;
  /** Where every write redirects — the CALLER's own URL, so the two doors differ. */
  returnTo: string;
  /** MUSTER_CLOSE_ROLES.includes(role) — the reopen form's loop copy needs it. */
  canClose: boolean;
  outcomes: { retime: FixOutcome; undo: FixOutcome; add: FixOutcome; reopen: FixOutcome };
  /** Panel only: the day's queue position and its neighbours. */
  queue?: React.ReactNode;
  /**
   * Spec 404 U2 — an OVERRIDE for the three withheld-control lines shown when no
   * project could be resolved.
   *
   * Those lines say `เลือกโครงการก่อน จึงจะ…`, an INSTRUCTION that is true only
   * where a project can be chosen: `/team/attendance/fix` takes `?project=` and
   * the grid's panel sits under a picker. The calendar has neither, so there the
   * same sentence names an act its reader cannot perform — the shared-copy rule
   * (one string, two audiences with different powers).
   *
   * ⚠️ An override, NOT a required prop with one generic default. The three
   * sentences differ by what is withheld (reopen / add-and-edit / trail), and
   * collapsing them into one would remove that distinction from the route that
   * has always had it — a signal deleted for a surface that never needed it.
   */
  noProjectHint?: string | null;
}) {
  const { workerName, projectName, sessions, dayClosed, teamId, offersAdd, addState, addTeams } =
    data;
  const trail = data.trail;
  const addNotice = addState?.control === "none" ? ADD_WITHHELD_COPY[addState.reason] : null;

  return (
    // ⚠️ Spec 404 U2b — the panel is its OWN container, and that is the whole
    // fix. Its three forms used to key their row/stack layouts on `sm:`, a
    // VIEWPORT query, while this panel is docked into boxes of wildly different
    // widths: a full-width page section on /team/attendance/fix, a wide card on
    // /team/attendance, and a fixed 280–340px column beside the spec-404
    // calendar. In that column the row fired at every viewport ≥640px, leaving
    // the reopen reason input 61px of usable width at 834 and 81px at 1194
    // against a 155px placeholder — the truncated `เช่น ลงเวลาไ` on the
    // operator's screenshot — and the two retime time fields at different
    // x-origins.
    //
    // Declaring it HERE rather than asking each caller to do it means a fourth
    // door cannot forget: the forms measure the panel, and the panel is exactly
    // the box they are in. Callers need nothing.
    <div className="@container">
      {queue}
      <h2 className={SECTION_HEADING}>{workerName}</h2>
      <p className="text-ink-secondary mt-1 text-sm">
        {formatThaiDate(date)}
        {projectName !== null ? ` · ${projectName}` : ""}
      </p>
      {/* The closure state, EXCEPT when the locked group below is rendering —
          `dayClosureLabel` returns exactly "ปิดวันแล้ว" for a closed day, which is
          that card's own heading, so both printed the same two words one above the
          other. The open states have no card, so they still need this line. */}
      {dayClosed === false && (
        <p className="text-ink-secondary mt-1 text-xs">
          {dayClosureLabel({ workDate: date, dayClosed }, todayIso)}
        </p>
      )}

      {outcomes.reopen !== null && (
        <div className="mt-3">
          {outcomes.reopen.ok ? (
            <p className="border-edge bg-sunk text-ink rounded-card border px-4 py-3 text-sm">
              เปิดวันดังกล่าวอีกครั้งแล้ว
            </p>
          ) : (
            <ErrorNotice>{outcomes.reopen.message}</ErrorNotice>
          )}
        </div>
      )}

      {/* The LOCK, before the things it locks — state that governs a section
          belongs above that section. */}
      {dayClosed === true && (
        <div className={`${CARD} mt-4 flex flex-col gap-3`}>
          <h3 className="text-ink text-sm font-semibold">{MUSTER_DAY_CLOSED_LABEL}</h3>
          <p className="text-ink-secondary text-xs">
            ตอนนี้แก้เวลาได้ตามปกติ — เพิ่มคนที่ตกหล่นหรือลบการเช็คชื่อต้องเปิดวันก่อน ·
            การเปิดและปิดมีผลทั้งวัน คิดค่าแรงใหม่ทุกคน ไม่ใช่แค่คนนี้
          </p>
          {data.projectId !== null ? (
            <MusterReopenForm
              projectId={data.projectId}
              workDate={date}
              returnTo={returnTo}
              canClose={canClose}
            />
          ) : (
            <p className="text-ink-secondary text-xs">
              {noProjectHint ?? "เลือกโครงการก่อน จึงจะเปิดวันดังกล่าวได้"}
            </p>
          )}
        </div>
      )}

      {sessions.length === 0 && (
        <div className={`${CARD} mt-4`}>
          <EmptyNotice>ยังไม่มีการเช็คชื่อของช่างคนนี้ในวันดังกล่าว</EmptyNotice>
        </div>
      )}

      {sessions.length > 0 && (
        <div className={`${CARD} mt-4 flex flex-col gap-4`}>
          <h3 className="text-ink text-sm font-semibold">แก้เวลา</h3>
          {outcomes.retime !== null &&
            (outcomes.retime.ok ? (
              <p className="border-edge bg-sunk text-ink rounded-card border px-3 py-2 text-xs">
                บันทึกเวลาใหม่แล้ว
              </p>
            ) : (
              <ErrorNotice>{outcomes.retime.message}</ErrorNotice>
            ))}
          {sessions.map((s) => (
            <AttendanceFixRetimeForm
              key={s.session}
              teamId={teamId!}
              workerId={workerId}
              session={s.session}
              workDate={date}
              returnTo={returnTo}
              currentInAt={s.inAt}
              currentOutAt={s.outAt}
              outLocked={outTimeLocked({ outAt: s.outAt, outAuto: s.outAuto })}
            />
          ))}
        </div>
      )}

      {dayClosed === false && (
        <div className={`${CARD} mt-4 flex flex-col gap-4`}>
          {sessions.length > 0 && (
            <div>
              <h3 className="text-ink text-sm font-semibold">ลบการเช็คชื่อ</h3>
              {outcomes.undo !== null &&
                (outcomes.undo.ok ? (
                  <p className="border-edge bg-sunk text-ink rounded-card mt-2 border px-3 py-2 text-xs">
                    ลบแล้ว
                  </p>
                ) : (
                  <div className="mt-2">
                    <ErrorNotice>{outcomes.undo.message}</ErrorNotice>
                  </div>
                ))}
              <div className="mt-2 flex flex-col gap-2">
                {sessions.map((s) => (
                  <AttendanceFixUndoForm
                    key={s.session}
                    workerId={workerId}
                    workDate={date}
                    session={s.session}
                    returnTo={returnTo}
                  />
                ))}
              </div>
            </div>
          )}

          {/* The heading lives INSIDE the same condition as the thing it titles:
              `addNotice` is non-null for every refusal reachable here, so the
              section can never render as a bare heading with nothing under it. */}
          {offersAdd && (addState?.control === "add" || addNotice !== null) && (
            <div>
              <h3 className="text-ink text-sm font-semibold">เพิ่มคนที่ตกหล่น</h3>
              {outcomes.add !== null &&
                (outcomes.add.ok ? (
                  <p className="border-edge bg-sunk text-ink rounded-card mt-2 border px-3 py-2 text-xs">
                    เพิ่มคนที่ตกหล่นแล้ว
                  </p>
                ) : (
                  <div className="mt-2">
                    <ErrorNotice>{outcomes.add.message}</ErrorNotice>
                  </div>
                ))}
              {addState?.control === "add" ? (
                <AttendanceFixAddForm
                  workerId={workerId}
                  workDate={date}
                  returnTo={returnTo}
                  teams={addTeams}
                />
              ) : (
                <p className="text-ink-secondary mt-2 text-xs">{addNotice}</p>
              )}
            </div>
          )}
        </div>
      )}

      {dayClosed === null && (
        <p className="text-ink-secondary mt-4 text-xs">
          {noProjectHint ?? "เลือกโครงการก่อน จึงจะเพิ่มหรือแก้ไขการเช็คชื่อได้"}
        </p>
      )}

      <div className={`${CARD} mt-4`}>
        <h3 className="text-ink text-xs font-semibold">การแก้ไขย้อนหลัง</h3>
        {trail === null ? (
          <p className="text-ink-secondary mt-1 text-xs">
            {noProjectHint ?? "เลือกโครงการก่อน จึงจะดูประวัติการแก้ไขได้"}
          </p>
        ) : trail.length === 0 ? (
          <p className="text-ink-secondary mt-1 text-xs">
            ยังไม่มีการแก้ไขย้อนหลังของช่างคนนี้ในวันดังกล่าว
          </p>
        ) : (
          <ul aria-label="ประวัติการแก้ไขย้อนหลัง" className="mt-1 flex flex-col gap-2">
            {trail.map((row, i) => {
              const event = describeAuditEvent(row);
              return (
                <li key={`${row.loggedAt}-${i}`} className="text-xs">
                  <p className="text-ink">
                    {formatThaiDateTime(row.loggedAt)} · {event.action}
                  </p>
                  {event.detail !== null && (
                    <p className="text-ink-secondary mt-0.5">{event.detail}</p>
                  )}
                  <p className="text-ink-secondary mt-0.5">
                    โดย {row.actorName ?? "ไม่ทราบผู้แก้ไข"} ({USER_ROLE_LABEL[row.actorRole]})
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Why the add form is withheld, in words, for every reason REACHABLE here.
 *
 *  Keyed on the reason UNION (not `string`), so a sixth `addPersonControl` arm
 *  reds at typecheck rather than rendering an empty paragraph. The three `null`s
 *  are unreachable on this screen and say so: `noProject` resolves dayClosed to
 *  null (a different branch entirely), `closed` cannot occur inside the
 *  dayClosed===false block that hosts this control, and `notPermitted` cannot
 *  occur because both doors are gated on MUSTER_CORRECT_ROLES. */
const ADD_WITHHELD_COPY: Record<
  Extract<AddPersonControl, { control: "none" }>["reason"],
  string | null
> = {
  future: "วันดังกล่าวยังมาไม่ถึง — ยังไม่มีการเช็คชื่อให้แก้ไข",
  noTeams: "ยังไม่มีทีมของวันดังกล่าว — เพิ่มคนที่ตกหล่นไม่ได้",
  noProject: null,
  closed: null,
  notPermitted: null,
};
