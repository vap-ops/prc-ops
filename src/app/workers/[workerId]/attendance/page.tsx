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
import { loadWorkerAttendance } from "@/lib/attendance/load-worker-attendance";
import {
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
  // Gated on MUSTER_CORRECT_ROLES, which is NOT this page's gate:
  // WORKER_ROSTER_ROLES includes project_manager and project_director, and every
  // correction RPC refuses both with 42501 — so they keep the whole calendar and
  // lose only the link. (Since spec 400 U6c both sets DO overlap on those two
  // roles; the gate stays keyed on the correction set so a future narrowing
  // re-separates them automatically.)
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

  // The days a cell actually opens — so the steppers and the grid can never
  // disagree about what this month holds. `month.cells` is keyed by date and
  // already filtered to the anchor month by the builder.
  const doorDates = Object.keys(month.cells);
  const steps = openDate === null ? { prev: null, next: null } : fixStepDates(doorDates, openDate);

  // The project the panel's writes act on. A day that carries attendance states
  // its own; an EMPTY day borrows the month's only project, and gets NOTHING
  // when the month is split — see `fixPanelProjectId`.
  const fixProjectId =
    openDate === null
      ? null
      : fixPanelProjectId({
          cellProjectId: month.cells[openDate]?.projectId ?? null,
          monthProjectIds: month.summary.projectDays
            .map((p) => p.projectId)
            .filter((id): id is string => id !== null),
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
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className={`min-w-0 flex-1 ${openDate !== null ? "hidden md:block" : ""}`}>
            <WorkerAttendanceCalendar
              month={month}
              worker={data.worker}
              stdRate={data.stdRate}
              prevHref={prevHref}
              nextHref={nextHref}
              dayFixHref={dayFixHref}
              openFixDate={openDate}
            />
          </div>

          {target.open === false && target.reason !== null && (
            <div className="w-full md:w-[300px] md:shrink-0">
              {/* Permanent for that URL — never ลองใหม่. §6 cases 1 and 2. */}
              <ErrorNotice>
                {target.reason === "outside"
                  ? "วันที่เลือกไม่อยู่ในเดือนนี้"
                  : "ลิงก์ไม่ถูกต้อง — วันที่ไม่ถูกต้อง"}
              </ErrorNotice>
            </div>
          )}

          {openDate !== null && (
            <aside className="w-full md:w-[300px] md:shrink-0">
              <div className={CARD}>
                {/* The strip goes through WorkerDayFixPanel's own `queue` slot —
                    U7 built it for exactly this, so the panel needs no change. */}
                {fixData === null ? (
                  <ErrorNotice>ไม่พบช่างคนนี้</ErrorNotice>
                ) : (
                  <WorkerDayFixPanel
                    data={fixData}
                    workerId={workerId}
                    date={openDate}
                    todayIso={todayIso}
                    returnTo={panelHref(openDate)}
                    canClose={MUSTER_CLOSE_ROLES.includes(ctx.role)}
                    outcomes={outcomes}
                    queue={
                      <div className="border-edge mb-3 flex flex-wrap items-center gap-2 border-b pb-2">
                        {/* ⚠️ The arrows NAME the axis. The grid's identical
                            control walks the next PERSON within a day; here it
                            walks the next DAY for one person. Same component,
                            opposite meaning — bare chevrons would let a reader
                            carry the wrong model across two surfaces.
                            They step to the next day that CARRIES attendance:
                            walking through 20 blank cells is the cry-wolf
                            failure U6b already ruled against. */}
                        {steps.prev !== null ? (
                          <Link
                            href={panelHref(steps.prev)}
                            className={`${DAY_STEP} text-action hover:bg-sunk`}
                          >
                            ‹ วันก่อนหน้า
                          </Link>
                        ) : (
                          <span aria-disabled className={`${DAY_STEP} text-ink-muted`}>
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
                          <span aria-disabled className={`${DAY_STEP} text-ink-muted`}>
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
                {/* §6 case 3 — an empty day the month cannot supply a project
                    for. Permanent, and it NAMES the surface that can resolve it
                    rather than promising a retry. Rendered BESIDE the panel, not
                    instead of it: the day's own facts still stand, only the
                    project-bound controls cannot be offered. */}
                {fixData !== null && fixData.projectId === null && (
                  <p className="text-ink-secondary mt-3 text-xs">
                    วันนี้ยังไม่มีการเช็คชื่อ และยังไม่ทราบโครงการ — เปิดจากหน้าตารางเช็คชื่อแทน
                  </p>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </PageShell>
  );
}
