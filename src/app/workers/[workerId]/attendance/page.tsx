// Spec 374 U1 — /workers/[workerId]/attendance: the per-worker check-in/out
// month calendar (ปฏิทินเข้างาน), the procurement answer to "verify a
// technician's attendance history, linked with the rate". Muster truth +
// labor_logs recorded days + the worker's rate, one month per screen.
//
// Gate: WORKER_ROSTER_ROLES — the exact set already trusted with day_rate on
// /workers; the admin-client loader is authorized by this gate (day_rate has
// no authenticated grant, labor_logs has no authenticated SELECT, and plain
// procurement fails muster's can_see_project RLS, so the seam is the point).
// Multi-parent detail: /workers roster rows and /payroll rows both link here,
// so the back chip resolves ?from via the referrer-aware standard.
//
// Spec 404 U2 — a day cell opens the worker-day FIX PANEL on this same route
// (`?fix=<YYYY-MM-DD>`) instead of navigating to /team/attendance/fix. Server
// Component, plain POST forms + redirect, ZERO client JS — the shape spec 400 U7
// proved on the grid, where `<dialog>` was explicitly rejected because it pays
// the same server round trip and costs the page its zero-JS property. This unit
// invents no panel: `loadWorkerDayFix` + `WorkerDayFixPanel` are U7's, unchanged.

import { notFound } from "next/navigation";
import Link from "next/link";

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { ErrorNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import {
  MUSTER_CLOSE_ROLES,
  MUSTER_CORRECT_ROLES,
  WORKER_ROSTER_ROLES,
} from "@/lib/auth/role-home";
import { safeBackHref } from "@/lib/nav/back-href";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import { addMonthsIso } from "@/lib/work-packages/calendar-grid";
import { isValidUuid } from "@/lib/validate/uuid";
import { ATTENDANCE_CALENDAR_LABEL } from "@/lib/i18n/labels";
import { buildAttendanceMonth, resolveMonthAnchor } from "@/lib/attendance/attendance-month";
import {
  loadProjectHeadcountByDate,
  loadWorkerAttendance,
  loadWorkerMusterDates,
} from "@/lib/attendance/load-worker-attendance";
import {
  calendarBlankDayFixable,
  calendarFixTarget,
  fixPanelProjectId,
  fixStepDates,
  type CalendarFixTarget,
} from "@/lib/attendance/fix-panel";
import {
  ADD_ERROR_COPY,
  REOPEN_ERROR_COPY,
  RETIME_ERROR_COPY,
  UNDO_ERROR_COPY,
  readOutcome,
} from "@/lib/muster/outcome-copy";
import { loadWorkerDayFix } from "@/lib/muster/worker-day-fix";
import { WorkerDayFixPanel } from "@/components/features/muster/worker-day-fix-panel";
import { createClient as createServerClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { WorkerAttendanceCalendar } from "@/components/features/labor/worker-attendance-calendar";

export const metadata = { title: ATTENDANCE_CALENDAR_LABEL };

/** The stepper's box, so วันก่อนหน้า and its disabled twin occupy the same space. */
const DAY_STEP =
  "rounded-control border-edge inline-flex min-h-11 items-center border px-2 text-xs";

export default async function WorkerAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ workerId: string }>;
  // Next hands back string | string[] for repeated params — normalize, never
  // assume the scalar shape (a doubled ?from would otherwise leak a bogus
  // "a,b" target into the stepper links).
  searchParams: Promise<{
    m?: string | string[];
    from?: string | string[];
    /** Spec 404 U2 — the day the fix panel is open on. Absent = closed. */
    fix?: string | string[];
    /** The project the OPEN panel already resolved — see `paramProjectId`. */
    fixp?: string | string[];
    // The five correction forms redirect back HERE with a CODE, never a
    // sentence — a Thai message in the URL is unbounded and forgeable.
    retimed?: string | string[];
    retimeError?: string | string[];
    undone?: string | string[];
    undoError?: string | string[];
    added?: string | string[];
    addError?: string | string[];
    reopened?: string | string[];
    reopenError?: string | string[];
  }>;
}) {
  const { workerId } = await params;
  const sp = await searchParams;
  const { m, from: fromRaw, fix } = sp;
  const from = Array.isArray(fromRaw) ? fromRaw[0] : fromRaw;
  const ctx = await requireRole(WORKER_ROSTER_ROLES);

  // A non-uuid segment is a 22P02 at PostgREST — surface it as the 404 it is,
  // not a 500 (same dead-end class the attendance-audit lib documents).
  if (!isValidUuid(workerId)) notFound();

  const monthAnchor = resolveMonthAnchor(m, bangkokTodayIso());

  const data = await loadWorkerAttendance(workerId, monthAnchor, ctx.role, ctx.id);
  if (!data) notFound();

  const month = buildAttendanceMonth({
    monthAnchor,
    musterRows: data.musterRows,
    paidRows: data.paidRows,
    dayRate: data.worker.dayRate,
    holidays: data.holidays,
  });

  // Spec 400 U6b — a day with attendance is a door.
  //
  // Operator 2026-08-07: "attendance calendar view is not edittable? it feels
  // like it can be interactive, especially accessing from tablets."
  //
  // Gated on MUSTER_CORRECT_ROLES, which is NOT this page's gate.
  //
  // ⚠️ Today that gate is unconditionally TRUE here, and the comment this
  // replaced still said the opposite: it claimed "every correction RPC refuses
  // project_manager and project_director with 42501", which was correct until
  // spec 400 U6c widened MUSTER_CORRECT_ROLES to all of ATTENDANCE_AUDIT_ROLES.
  // WORKER_ROSTER_ROLES is now a strict SUBSET of it, so no reader of this page
  // is currently withheld. The gate is kept — the operator explicitly reserved
  // narrowing that set again ("we can limit access in the future"), and the day
  // they do, the door and the `?fix=` read both close by themselves rather than
  // becoming affordance-then-refuse.
  const canCorrect = MUSTER_CORRECT_ROLES.includes(ctx.role);

  // Month steppers must carry the referrer forward, or paging a month would
  // silently reset the back chip to the fallback parent.
  //
  // ⚠️ They must also DROP `?fix=`: the panel's target is bounded to the month
  // on screen, so carrying it into the next month would arrive as the `outside`
  // refusal — a reader paging months would collect an error notice they never
  // asked for.
  const base = `/workers/${workerId}/attendance`;
  const withFrom = (anchor: string) =>
    `${base}?m=${anchor.slice(0, 7)}${from ? `&from=${encodeURIComponent(from)}` : ""}`;
  const prevHref = withFrom(addMonthsIso(monthAnchor, -1));
  const nextHref = withFrom(addMonthsIso(monthAnchor, 1));

  // ── Spec 404 U2 — the fix panel, on this page ────────────────────────────
  //
  // The URL is the whole state machine: opening, stepping and closing are plain
  // links, and every write redirects back to the panel's own href. Nothing here
  // hydrates, which is what makes it work on the field devices whose hydration
  // this repo has watched fail.
  //
  // `panelHref` retires U6b's `withFrom(monthAnchor)` threading into
  // `/team/attendance/fix`: there is no longer a second page to hand a back chip
  // to. That route is untouched and still serves every link minted elsewhere.
  const panelHref = (date: string | null) =>
    date === null ? withFrom(monthAnchor) : `${withFrom(monthAnchor)}&fix=${date}`;
  const dayFixHref = canCorrect ? (date: string) => panelHref(date) : null;

  // ⚠️ The `?fix=` param is read ONLY for the correction audience. A reader
  // outside MUSTER_CORRECT_ROLES who lands on a shared link gets the calendar,
  // not a panel of controls every RPC would refuse them — affordance-then-refuse
  // is the failure this gate exists to prevent, and a hand-typed URL is exactly
  // how it would arrive.
  const target: CalendarFixTarget = canCorrect
    ? calendarFixTarget(fix, monthAnchor)
    : { open: false, reason: null };
  const openDate = target.open ? target.date : null;

  // ── Spec 404 U2b — the BLANK days that are doors ─────────────────────────
  //
  // Operator ruling 2026-08-08: mirror `/team/attendance`'s gap-cell rule
  // (`gridCellFixable`), do not invent a second one. A day this worker has no
  // row on, at a project that scanned other people, is fully serviceable — the
  // panel offers เพิ่มคนที่ตกหล่น — but nothing linked it, so the screen built
  // for "the muster missed him" was reachable only by hand-typing a URL.
  //
  // The read is bought ONLY when a door could actually be offered: the viewer
  // can correct AND the month names exactly one project, because an empty day of
  // a SPLIT month has two possible owners and no evidence (`fixPanelProjectId`).
  // On every other month view this costs nothing.
  const monthProjectIds = month.summary.projectDays
    .map((p) => p.projectId)
    .filter((id): id is string => id !== null);
  const blankDoorProjectId =
    canCorrect && monthProjectIds.length === 1 ? monthProjectIds[0]! : null;
  const [projectHeadcountByDate, workerMusterDates] =
    blankDoorProjectId === null
      ? [{} as Record<string, number>, new Set<string>()]
      : await Promise.all([
          loadProjectHeadcountByDate(blankDoorProjectId, monthAnchor),
          loadWorkerMusterDates(workerId, monthAnchor),
        ]);
  // Iterated over the cells the GRID DRAWS, not over the dates the read
  // returned: the rule's `headcount > 0` arm has to be able to refuse, and a
  // candidate list built from scanned dates alone could never exercise it.
  const blankFixDates = new Set(
    month.grid.weeks
      .flat()
      .filter((c) => c.inMonth && month.cells[c.iso] === undefined)
      .map((c) => c.iso)
      // ⚠️ A cell can be blank because the VIEWER cannot see the row, not
      // because there is none: `loadWorkerAttendance` is membership-scoped for
      // any role outside `viewerSeesAllMusterProjects`, and `project_manager`
      // sits in BOTH this page's gate and the correction audience. Offering a
      // door there would reach `muster_correct_session`, whose existing-row
      // lookup is `worker_id + work_date + session` with no project predicate
      // (read from the live definition), so it would take the UPDATE path and
      // refuse on press with "worker is in another team today — move first".
      // `loadWorkerMusterDates` names those dates so they can be WITHHELD;
      // nothing about them is rendered, named or counted. Disclosing them is
      // spec 404 §5's job (U3), not this one's.
      .filter((date) => !workerMusterDates.has(date))
      .filter((date) =>
        calendarBlankDayFixable({
          date,
          holidayName: month.holidayByDate[date] ?? null,
          projectHeadcount: projectHeadcountByDate[date] ?? 0,
          // ⚠️ NOT a hardcoded `true`. That left `gridCellFixable`'s
          // `canFixGaps` arm dead at its only call site, with the real gate
          // smuggled through the headcount map being empty — the rule would
          // claim a decision something else was actually making, and a mutation
          // of this line would change nothing.
          projectResolvable: blankDoorProjectId !== null,
        }),
      ),
  );

  // The days a cell actually opens — so the steppers and the grid can never
  // disagree about what this month holds. `month.cells` is keyed by date and
  // already filtered to the anchor month by the builder; the blank doors join
  // it for exactly that reason (see `fixStepDates`).
  const doorDates = [...Object.keys(month.cells), ...blankFixDates];
  const steps = openDate === null ? { prev: null, next: null } : fixStepDates(doorDates, openDate);

  // The project the panel's writes act on. A day that carries attendance states
  // its own; an EMPTY day borrows the month's only project, and gets NOTHING
  // when the month is split — see `fixPanelProjectId`.
  //
  // ⚠️ `?fixp=` is the RESOLVED id, carried by this panel's own returnTo and by
  // nothing else. Without it, deleting the last session of a single-day month
  // re-renders with no cell project AND an empty month set: the corrector loses
  // the closure state, the add form and the trail, immediately after the only
  // destructive action, with no way to re-add the person they just removed.
  // That dead end is documented on `/team/attendance/fix`, which threads the
  // same value for the same reason; a fresh-eyes pass caught it missing here.
  // Shape-validated, because an unvalidated uuid reaches PostgREST as 22P02.
  const fixpRaw = Array.isArray(sp.fixp) ? undefined : sp.fixp;
  const paramProjectId = fixpRaw !== undefined && isValidUuid(fixpRaw) ? fixpRaw : null;
  const fixProjectId =
    openDate === null
      ? null
      : fixPanelProjectId({
          paramProjectId,
          cellProjectId: month.cells[openDate]?.projectId ?? null,
          monthProjectIds,
        });

  const todayIso = bangkokTodayIso();
  // Read ONLY when a panel is actually open: a closed panel must not buy five
  // round trips (a worker read, the detail RPC, a closure lookup, the team list
  // and the audit trail) on every month view.
  const fixData =
    openDate === null
      ? null
      : await loadWorkerDayFix({
          supabase: await createServerClient(),
          admin: createAdminClient(),
          workerId,
          date: openDate,
          projectParam: fixProjectId,
          todayIso,
        });

  const outcomes = {
    retime: readOutcome(sp.retimed, sp.retimeError, RETIME_ERROR_COPY),
    undo: readOutcome(sp.undone, sp.undoError, UNDO_ERROR_COPY),
    add: readOutcome(sp.added, sp.addError, ADD_ERROR_COPY),
    reopen: readOutcome(sp.reopened, sp.reopenError, REOPEN_ERROR_COPY),
  };

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Generic กลับ: the chip's target follows ?from (roster OR payroll), so
          a parent-specific label would announce the wrong destination — the
          feedback/[id] precedent for referrer-aware chips. */}
      <DetailHeader backHref={safeBackHref(from, "/workers")} backLabel="กลับ">
        <h1 className="text-title text-ink font-bold tracking-tight">
          {ATTENDANCE_CALENDAR_LABEL}
        </h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {/* ── Two bands, and the split is at `md`, not `lg` ────────────────
            A tablet is TWO widths that swap under the user's hand — iPad Pro 11
            is 1194 landscape / 834 portrait — so an `lg:` split would appear and
            vanish on rotation. At `md+` the panel docks beside the calendar;
            below it, the panel REPLACES the calendar (same route, same URL), so
            a phone gets one readable surface instead of two cramped ones.

            ⚠️ Rendered ONCE and hidden with CSS rather than branched in JS: the
            markup is identical in both bands, so a branch would be a second
            copy to keep in step for no gain.

            ⚠️ NO independent scroller. An `overflow-y` panel would be a NEW
            scroller, and this repo has shipped two opposite touch-action bugs on
            those (memory `prc-ops-touch-action-scroll-rows`). The page scrolls;
            the column is as tall as it is. */}
        {/* The refusal goes ABOVE the grid, not beside it. On a phone the
            calendar is six rows tall and stays rendered in this state, so a
            reader following a stale `?fix=` would scroll a whole month before
            meeting the explanation for what did not happen. */}
        {target.open === false && target.reason !== null && (
          <div className="mb-4">
            {/* Permanent for that URL — never ลองใหม่. §6 cases 1 and 2. */}
            <ErrorNotice>
              {target.reason === "outside"
                ? "วันที่เลือกไม่อยู่ในเดือนนี้"
                : "ลิงก์ไม่ถูกต้อง — วันที่ไม่ถูกต้อง"}
            </ErrorNotice>
          </div>
        )}
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className={`min-w-0 flex-1 ${openDate !== null ? "hidden md:block" : ""}`}>
            <WorkerAttendanceCalendar
              month={month}
              worker={data.worker}
              stdRate={data.stdRate}
              prevHref={prevHref}
              nextHref={nextHref}
              dayFixHref={dayFixHref}
              blankFixDates={blankFixDates}
              openFixDate={openDate}
            />
          </div>

          {openDate !== null && (
            // 280px in the `md` band, 340 above it. Measured, not chosen: at 834
            // a 300px panel leaves a 68px column whose 60px of usable width is
            // narrower than the `07:42–18:00` line it has to hold (~70px at
            // 10px), so the merged line wrapped back into the two lines the
            // compaction exists to remove — through the WHOLE 768–1000 range,
            // including the 834 an earlier probe "confirmed" by measuring the
            // column and never the text inside it. Above `lg` the grid has room
            // to spare (340px still leaves ~108px per column at 1194), and the
            // panel is where the width is actually needed.
            //
            // ⓘ No `@container` here: `WorkerDayFixPanel` declares its own, so
            // the forms measure the panel rather than whichever box a door
            // happens to dock it into. A fourth door cannot forget.
            // ⚠️ Spec 404 U2c raised the `md` width 280 → 300, and it is a
            // MEASURED trade with both sides on the record. The operator asked
            // for เข้า/ออก side by side at every width; at 280 the panel's field
            // box is 102px against a 108px native time control (at the design
            // 15px, with the padding already cut to `px-1`) — it would clip.
            // Driven in real Chrome at 768/834/900 across panel 280/300/320/340:
            // 300 gives a 112px field (4px spare) and costs the grid NOTHING —
            // cells wrapped 1/3, 1/3, 0/3, identical to 280 at all three widths.
            // 320 would have fit more comfortably and pushed 768 to 3/3 wrapped.
            // This also returns to §4.2's own arithmetic, which assumed 300.
            <aside className="w-full md:w-[300px] md:shrink-0 lg:w-[340px]">
              <div className={CARD}>
                {/* §6 case 3 — an empty day the month cannot supply a project
                    for. ABOVE the panel on purpose: the panel's own withheld-
                    control lines read `เลือกโครงการก่อน …`, which is true on
                    `/team/attendance/fix` (a `?project=` exists to supply) and
                    FALSE here, where no picker exists — so the reader must meet
                    the statement that IS actionable first. `noProjectHint`
                    replaces those lines outright; this line is the summary. */}
                {fixData !== null && fixData.projectId === null && (
                  <p className="text-ink-secondary mb-3 text-xs">
                    วันนี้ยังไม่มีการเช็คชื่อ และยังไม่ทราบโครงการ — เปิดจากหน้าตารางเช็คชื่อแทน
                  </p>
                )}
                {/* The strip goes through WorkerDayFixPanel's own `queue` slot —
                    U7 built it for exactly this, so the panel needs no change.
                    ⚠️ `fixData === null` is unreachable today: `loadWorkerDayFix`
                    returns null only for a missing worker row, and
                    `loadWorkerAttendance` already `notFound()`s that above. Kept
                    as a fail-loud arm rather than a vanishing surface, since a
                    surface that disappears is indistinguishable from a crash. */}
                {fixData === null ? (
                  <ErrorNotice>ไม่พบช่างคนนี้</ErrorNotice>
                ) : (
                  <WorkerDayFixPanel
                    data={fixData}
                    workerId={workerId}
                    date={openDate}
                    todayIso={todayIso}
                    // ⚠️ The RESOLVED project rides the write's return url, never
                    // the steppers — see `fixPanelProjectId`.
                    returnTo={
                      fixData.projectId === null
                        ? panelHref(openDate)
                        : `${panelHref(openDate)}&fixp=${fixData.projectId}`
                    }
                    canClose={MUSTER_CLOSE_ROLES.includes(ctx.role)}
                    outcomes={outcomes}
                    noProjectHint="ยังไม่ทราบโครงการของวันนี้ — เปิดจากหน้าตารางเช็คชื่อแทน"
                    queue={
                      <div className="border-edge mb-3 flex flex-wrap items-center gap-2 border-b pb-2">
                        {/* ⚠️ The arrows NAME the axis. The grid's identical
                            control walks the next PERSON within a day; here it
                            walks the next DAY for one person. Same component,
                            opposite meaning — bare chevrons would let a reader
                            carry the wrong model across two surfaces.
                            They step to the next DOOR — a day carrying
                            attendance, or (since U2b) a blank day the project
                            scanned other people on. Every other blank cell is
                            skipped: walking through 20 of them is the cry-wolf
                            failure U6b already ruled against. */}
                        {steps.prev !== null ? (
                          <Link
                            href={panelHref(steps.prev)}
                            className={`${DAY_STEP} text-action hover:bg-sunk`}
                          >
                            ‹ วันก่อนหน้า
                          </Link>
                        ) : (
                          <span aria-disabled className={`${DAY_STEP} text-ink-secondary`}>
                            ‹ วันก่อนหน้า
                          </span>
                        )}
                        {steps.next !== null ? (
                          <Link
                            href={panelHref(steps.next)}
                            className={`${DAY_STEP} text-action hover:bg-sunk`}
                          >
                            วันถัดไป ›
                          </Link>
                        ) : (
                          <span aria-disabled className={`${DAY_STEP} text-ink-secondary`}>
                            วันถัดไป ›
                          </span>
                        )}
                        {/* Below `md` this is the ONLY way back to the calendar,
                            because the panel replaced it. */}
                        <Link
                          href={panelHref(null)}
                          className="text-action ml-auto flex min-h-11 items-center text-xs underline-offset-2 hover:underline"
                        >
                          ปิดหน้าต่างแก้ไข
                        </Link>
                      </div>
                    }
                  />
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </PageShell>
  );
}
