// Spec 400 U6a — the worker-day fix screen: retime, add or delete ONE person's
// attendance for ONE day, without opening the 42-row grid or the day panel.
// Design ratified with the operator over three widget revisions in chat before
// build (memory spec400-attendance-grid.md, "U6 PLAN, rev 3") — do not
// re-litigate the shape here:
//
//   - NO wizard / step strip. Gates are PER ACTION, measured from the live RPC
//     bodies: retime (`muster_correct_session`'s UPDATE path) works even on a
//     CLOSED day — its own guard is the unbooked-wage anti-join, built for the
//     nine 2026-07-24 OT rows, not the day's closure state. Add (the INSERT
//     path) and delete (`muster_undo_scan`) both require the day OPEN, so they
//     sit under ONE locked group whose header carries the reopen form, rather
//     than repeating the same gate on two separate cards.
//   - No time field ever has a default value: a wrong guessed timestamp is
//     worse than an empty one forcing a real value (U4's own rule).
//   - The trail is the SAME `list_muster_day_audit` RPC the day panel reads,
//     filtered in TypeScript to just this worker_id.
//
// Server Component, ZERO client JS: every control here is a plain POST form +
// redirect, matching every other muster correction surface in this app.
//
// Gated on MUSTER_CORRECT_ROLES, NOT MUSTER_CLOSE_ROLES: it is the correction
// RPCs' own allowlist and the one muster role set with no `site_admin` — she
// holds the cockpit for TODAY, but no surface reaching a PAST day has ever
// given her a door, and this one must not be the first.
//
// Reachable today only by a hand-typed URL. U6b (the grid's anomaly cells, the
// day panel's work-list rows, the spec-374 calendar) is the next unit's job and
// is deliberately NOT built here.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { requireRole } from "@/lib/auth/require-role";
import { MUSTER_CLOSE_ROLES, MUSTER_CORRECT_ROLES } from "@/lib/auth/role-home";
import { attendanceBackLabel, safeBackHref } from "@/lib/nav/back-href";
import {
  ATTENDANCE_FIX_LABEL,
  USER_ROLE_LABEL,
  formatThaiDate,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import { createClient as createServerClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { dayClosureLabel, loadAttendanceDetail } from "@/lib/muster/attendance-audit";
import { canAddMissingSession, outTimeLocked, parseFixParams } from "@/lib/muster/day-fix";
import { addPersonControl, type AddPersonControl } from "@/lib/muster/add-person";
import { describeAuditEvent, loadDayAudit } from "@/lib/muster/day-audit";
import {
  ADD_ERROR_COPY,
  REOPEN_ERROR_COPY,
  RETIME_ERROR_COPY,
  UNDO_ERROR_COPY,
} from "@/lib/muster/outcome-copy";
import { MusterReopenForm } from "@/components/features/muster/muster-reopen-form";
import { AttendanceFixRetimeForm } from "@/components/features/muster/attendance-fix-retime-form";
import { AttendanceFixUndoForm } from "@/components/features/muster/attendance-fix-undo-form";
import { AttendanceFixAddForm } from "@/components/features/muster/attendance-fix-add-form";

export const metadata = { title: ATTENDANCE_FIX_LABEL };

interface FixPageProps {
  searchParams: Promise<{
    worker?: string | string[];
    date?: string | string[];
    project?: string | string[];
    from?: string | string[];
    retimed?: string | string[];
    retimeError?: string | string[];
    undone?: string | string[];
    undoError?: string | string[];
    added?: string | string[];
    addError?: string | string[];
    reopened?: string | string[];
    reopenError?: string | string[];
  }>;
}

export default async function AttendanceFixPage({ searchParams }: FixPageProps) {
  const ctx = await requireRole(MUSTER_CORRECT_ROLES);
  const sp = await searchParams;
  const backHref = safeBackHref(sp.from, "/team/attendance");
  const backLabel = attendanceBackLabel(backHref);

  function shell(body: React.ReactNode) {
    return (
      <PageShell>
        <BottomTabBar role={ctx.role} />
        <DetailHeader backHref={backHref} backLabel={backLabel}>
          <h1 className="text-title text-ink font-bold tracking-tight">{ATTENDANCE_FIX_LABEL}</h1>
        </DetailHeader>
        <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>{body}</section>
      </PageShell>
    );
  }

  const params = parseFixParams(sp);
  if (params === null) {
    return shell(<ErrorNotice>ลิงก์ไม่ถูกต้อง — ต้องระบุช่างและวันที่ที่ถูกต้อง</ErrorNotice>);
  }
  const { workerId, date, projectId: projectParam } = params;

  const supabase = await createServerClient();
  const admin = createAdminClient();

  // The worker's own name. "workers" "readable by staff" is ROLE-only and
  // covers every MUSTER_CORRECT_ROLES member (procurement, procurement_manager,
  // super_admin — verified live), so the session client is enough.
  // ⚠️ The `error` is read, not discarded. `data === null` renders "ไม่พบช่างคนนี้"
  // — a factual claim that this worker does not exist — and a FAILED read is
  // indistinguishable from a genuinely missing row if only `data` is checked.
  // Making that claim about a worker who does exist is the honest-copy defect;
  // throwing surfaces the real failure instead.
  const { data: workerRow, error: workerError } = await supabase
    .from("workers")
    .select("id, name")
    .eq("id", workerId)
    .maybeSingle();
  if (workerError) throw new Error(`attendance fix: worker read failed: ${workerError.message}`);
  if (workerRow === null) {
    return shell(<ErrorNotice>ไม่พบช่างคนนี้</ErrorNotice>);
  }

  const range = projectParam
    ? { from: date, to: date, projectId: projectParam }
    : { from: date, to: date };
  const sessions = await loadAttendanceDetail(supabase, range, workerId);

  const projectId = projectParam ?? sessions[0]?.projectId ?? null;
  // A no-session worker-day carries no session to read the project's NAME off
  // of, even though `?project=` already gave us its id — the header would
  // otherwise show the date alone where every session-bearing render shows
  // "date · project". `projects` SELECT already admits procurement/
  // procurement_manager directly (verified live, documented on the day-panel
  // page above this one), so this is a session-client read, not an admin one.
  const projectNameFromSession =
    sessions.length === 0 && projectId !== null
      ? ((await supabase.from("projects").select("name").eq("id", projectId).maybeSingle()).data
          ?.name ?? null)
      : null;
  const projectName = sessions[0]?.projectName ?? projectNameFromSession;

  // Day closure. Sessions already carry it (a day-level fact, identical across
  // every session of one worker-day — attendance-audit.ts's own single-project
  // invariant). With no session yet, `muster_day_closures` RLS is
  // can_see_project — FALSE for procurement, probed live — so a narrow ADMIN
  // lookup on exactly this (project, date) is the only way to answer it for
  // this page's audience. No new exposure: `list_muster_day_audit` (gated on
  // this same audience) already discloses a muster_day_close/reopen row for
  // the same day when one exists, and reopen_muster_day's own refusal ("this
  // day is not closed") discloses the same fact behaviourally.
  let dayClosed: boolean | null = null;
  if (sessions.length > 0) {
    dayClosed = sessions.every((s) => s.dayClosed);
  } else if (projectId !== null) {
    // ⚠️ FAIL CLOSED. The `error` is read, not discarded: an errored read
    // returns `data === null`, which is byte-identical to "there is no closure
    // row", so branching on `data` alone would resolve `dayClosed = false` and
    // render the OPEN state — offering add and delete on a day that may in fact
    // be CLOSED. The RPCs still refuse the write, so that is
    // affordance-then-refuse rather than a hole, which is precisely the class
    // this repo ratchets against. Throwing matches every other read on this
    // page (the team lookup, the teams RPC, loadAttendanceDetail, loadDayAudit).
    const { data: closure, error: closureError } = await admin
      .from("muster_day_closures")
      .select("work_date")
      .eq("project_id", projectId)
      .eq("work_date", date)
      .maybeSingle();
    if (closureError) {
      throw new Error(`attendance fix: closure read failed: ${closureError.message}`);
    }
    dayClosed = closure !== null;
  }

  // The team id an existing session's retime must supply. `audit_attendance_detail`
  // (the session-client reader every audit surface uses) discloses the team's
  // LEAD NAME but never its id — `muster_attendance`/`muster_teams` RLS is
  // can_see_project, FALSE for procurement — so this is the same narrow-ADMIN
  // seam as the closure lookup above, for a row this same audience can already
  // read in substance through the RPC. A worker-day is single-team (an OT
  // session only opens after a regular one on the SAME team —
  // muster_scan_in's own invariant), so one lookup covers both session rows.
  let teamId: string | null = null;
  if (sessions.length > 0) {
    const { data: teamRow } = await admin
      .from("muster_attendance")
      .select("team_id")
      .eq("worker_id", workerId)
      .eq("work_date", date)
      .limit(1)
      .maybeSingle();
    if (!teamRow) throw new Error("attendance fix: team lookup failed for an existing session");
    teamId = teamRow.team_id;
  }

  const todayIso = bangkokTodayIso();

  // The add arm — only when there is no regular session yet for this
  // worker-day (muster_correct_session's insert path may only ever create
  // one). Teams are fetched only when the form could actually render: an
  // already-closed day would just pay a round trip for a control the locked
  // group replaces.
  const offersAdd = canAddMissingSession(sessions);
  const wantsAddTeams = offersAdd && projectId !== null && dayClosed !== true;
  const { data: dayTeams, error: dayTeamsError } = wantsAddTeams
    ? await supabase.rpc("list_muster_teams_for_day", { p_project: projectId!, p_date: date })
    : { data: null, error: null };
  if (dayTeamsError) throw new Error(`muster team list failed: ${dayTeamsError.message}`);
  const addTeams = (dayTeams ?? []).map((t) => ({
    teamId: t.team_id,
    leadName: t.lead_name,
    headcount: t.headcount,
  }));
  const addState = offersAdd
    ? addPersonControl({
        date,
        todayIso,
        dayClosed,
        projectId,
        canCorrect: true,
        teamCount: addTeams.length,
      })
    : null;

  /** Why the add form is withheld, in words, for every reason REACHABLE here.
   *
   *  Keyed on the reason UNION (not `string`), so a sixth `addPersonControl`
   *  arm reds at typecheck rather than rendering an empty paragraph. The three
   *  `null`s are unreachable on this page and say so: `noProject` resolves
   *  dayClosed to null (a different branch entirely), `closed` cannot occur
   *  inside the dayClosed===false block that hosts this control, and
   *  `notPermitted` cannot occur because the page is gated on
   *  MUSTER_CORRECT_ROLES. The render treats a null as "show no section at
   *  all", which is correct for a reason that cannot happen. */
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
  const addNotice = addState?.control === "none" ? ADD_WITHHELD_COPY[addState.reason] : null;

  // The trail — the SAME RPC the day panel reads, filtered to just this
  // worker. `null` (not `[]`) when there is no project to read: the RPC takes
  // exactly one, so a ทุกโครงการ column is never fetched.
  const fullTrail = projectId !== null ? await loadDayAudit(supabase, projectId, date) : null;
  const trail = fullTrail === null ? null : fullTrail.filter((r) => r.workerId === workerId);

  const retimeOutcome =
    sp.retimed === "1"
      ? ({ ok: true } as const)
      : typeof sp.retimeError === "string" && sp.retimeError.length > 0
        ? ({
            ok: false,
            message: RETIME_ERROR_COPY[sp.retimeError] ?? RETIME_ERROR_COPY.failed!,
          } as const)
        : null;
  const undoOutcome =
    sp.undone === "1"
      ? ({ ok: true } as const)
      : typeof sp.undoError === "string" && sp.undoError.length > 0
        ? ({
            ok: false,
            message: UNDO_ERROR_COPY[sp.undoError] ?? UNDO_ERROR_COPY.failed!,
          } as const)
        : null;
  const addOutcome =
    sp.added === "1"
      ? ({ ok: true } as const)
      : typeof sp.addError === "string" && sp.addError.length > 0
        ? ({ ok: false, message: ADD_ERROR_COPY[sp.addError] ?? ADD_ERROR_COPY.failed! } as const)
        : null;
  const reopenOutcome =
    sp.reopened === "1"
      ? ({ ok: true } as const)
      : typeof sp.reopenError === "string" && sp.reopenError.length > 0
        ? ({
            ok: false,
            message: REOPEN_ERROR_COPY[sp.reopenError] ?? REOPEN_ERROR_COPY.failed!,
          } as const)
        : null;

  const canClose = MUSTER_CLOSE_ROLES.includes(ctx.role);

  // The fix page's own current URL — every write action redirects back here
  // with its outcome appended.
  const returnTo = (() => {
    const q = new URLSearchParams({ worker: workerId, date });
    if (projectParam) q.set("project", projectParam);
    if (backHref !== "/team/attendance") q.set("from", backHref);
    return `/team/attendance/fix?${q.toString()}`;
  })();

  return shell(
    <>
      <h2 className={SECTION_HEADING}>{workerRow.name}</h2>
      <p className="text-ink-secondary mt-1 text-sm">
        {formatThaiDate(date)}
        {projectName !== null ? ` · ${projectName}` : ""}
      </p>
      {dayClosed !== null && (
        <p className="text-ink-secondary mt-1 text-xs">
          {dayClosureLabel({ workDate: date, dayClosed }, todayIso)}
        </p>
      )}

      {reopenOutcome !== null && (
        <div className="mt-3">
          {reopenOutcome.ok ? (
            <p className="border-edge bg-sunk text-ink rounded-card border px-4 py-3 text-sm">
              เปิดวันดังกล่าวอีกครั้งแล้ว
            </p>
          ) : (
            <ErrorNotice>{reopenOutcome.message}</ErrorNotice>
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
          {retimeOutcome !== null &&
            (retimeOutcome.ok ? (
              <p className="border-edge bg-sunk text-ink rounded-card border px-3 py-2 text-xs">
                บันทึกเวลาใหม่แล้ว
              </p>
            ) : (
              <ErrorNotice>{retimeOutcome.message}</ErrorNotice>
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

      {dayClosed === true && (
        <div className={`${CARD} mt-4 flex flex-col gap-3`}>
          <h3 className="text-ink text-sm font-semibold">ปิดวันแล้ว</h3>
          <p className="text-ink-secondary text-xs">
            เพิ่มคนที่ตกหล่นหรือลบการเช็คชื่อของวันนี้ไม่ได้จนกว่าจะเปิดวันอีกครั้ง —
            เปิดแล้วมีผลทั้งวัน ปิดใหม่คิดค่าแรงทุกคน ไม่ใช่แค่คนนี้
          </p>
          {projectId !== null ? (
            <MusterReopenForm
              projectId={projectId}
              workDate={date}
              returnTo={returnTo}
              canClose={canClose}
            />
          ) : (
            <p className="text-ink-secondary text-xs">เลือกโครงการก่อน จึงจะเปิดวันดังกล่าวได้</p>
          )}
        </div>
      )}

      {dayClosed === false && (
        <div className={`${CARD} mt-4 flex flex-col gap-4`}>
          {sessions.length > 0 && (
            <div>
              <h3 className="text-ink text-sm font-semibold">ลบการเช็คชื่อ</h3>
              {undoOutcome !== null &&
                (undoOutcome.ok ? (
                  <p className="border-edge bg-sunk text-ink rounded-card mt-2 border px-3 py-2 text-xs">
                    ลบแล้ว
                  </p>
                ) : (
                  <div className="mt-2">
                    <ErrorNotice>{undoOutcome.message}</ErrorNotice>
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

          {/* The heading lives INSIDE the same condition as the thing it
              titles: `addNotice` is non-null for every refusal reachable here,
              so the section can never render as a bare heading with nothing
              under it. Only `future` and `noTeams` are reachable — `noProject`
              resolves dayClosed to null (a different branch), `closed` cannot
              occur inside dayClosed===false, and `notPermitted` cannot occur
              because the whole page is gated on MUSTER_CORRECT_ROLES. */}
          {offersAdd && (addState?.control === "add" || addNotice !== null) && (
            <div>
              <h3 className="text-ink text-sm font-semibold">เพิ่มคนที่ตกหล่น</h3>
              {addOutcome !== null &&
                (addOutcome.ok ? (
                  <p className="border-edge bg-sunk text-ink rounded-card mt-2 border px-3 py-2 text-xs">
                    เพิ่มคนที่ตกหล่นแล้ว
                  </p>
                ) : (
                  <div className="mt-2">
                    <ErrorNotice>{addOutcome.message}</ErrorNotice>
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
          เลือกโครงการก่อน จึงจะเพิ่มหรือแก้ไขการเช็คชื่อได้
        </p>
      )}

      <div className={`${CARD} mt-4`}>
        <h3 className="text-ink text-xs font-semibold">การแก้ไขย้อนหลัง</h3>
        {trail === null ? (
          <p className="text-ink-secondary mt-1 text-xs">
            เลือกโครงการก่อน จึงจะดูประวัติการแก้ไขได้
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
    </>,
  );
}
