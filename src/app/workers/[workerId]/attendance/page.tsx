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

import { notFound } from "next/navigation";

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { MUSTER_CORRECT_ROLES, WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";
import { safeBackHref } from "@/lib/nav/back-href";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { bangkokTodayIso } from "@/lib/dates";
import { addMonthsIso } from "@/lib/work-packages/calendar-grid";
import { isValidUuid } from "@/lib/validate/uuid";
import { ATTENDANCE_CALENDAR_LABEL } from "@/lib/i18n/labels";
import { buildAttendanceMonth, resolveMonthAnchor } from "@/lib/attendance/attendance-month";
import { loadWorkerAttendance } from "@/lib/attendance/load-worker-attendance";
import { fixHref } from "@/lib/muster/day-fix";
import { WorkerAttendanceCalendar } from "@/components/features/labor/worker-attendance-calendar";

export const metadata = { title: ATTENDANCE_CALENDAR_LABEL };

export default async function WorkerAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ workerId: string }>;
  // Next hands back string | string[] for repeated params — normalize, never
  // assume the scalar shape (a doubled ?from would otherwise leak a bogus
  // "a,b" target into the stepper links).
  searchParams: Promise<{ m?: string | string[]; from?: string | string[] }>;
}) {
  const { workerId } = await params;
  const { m, from: fromRaw } = await searchParams;
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

  // Month steppers must carry the referrer forward, or paging a month would
  // silently reset the back chip to the fallback parent.
  const base = `/workers/${workerId}/attendance`;
  const withFrom = (anchor: string) =>
    `${base}?m=${anchor.slice(0, 7)}${from ? `&from=${encodeURIComponent(from)}` : ""}`;
  const prevHref = withFrom(addMonthsIso(monthAnchor, -1));
  const nextHref = withFrom(addMonthsIso(monthAnchor, 1));

  // Spec 400 U6b — a day with attendance opens that worker-day's fix screen.
  //
  // Operator 2026-08-07: "attendance calendar view is not edittable? it feels
  // like it can be interactive, especially accessing from tablets."
  //
  // Gated on MUSTER_CORRECT_ROLES, which is NOT this page's gate:
  // WORKER_ROSTER_ROLES includes project_manager and project_director, and every
  // correction RPC refuses both with 42501 — so they keep the whole calendar and
  // lose only the link.
  //
  // ⚠️ `withFrom(monthAnchor)` — the AUDITED month, not the current one. U1
  // shipped exactly this bug once: the grid's calendar link dropped `m=`, so a
  // checker auditing July landed on August. The fix screen's back chip has to
  // return to the month the reader was actually looking at.
  //
  // No `?project=`: this calendar holds `projectName` but no project id, so the
  // fix screen infers it from the session — which is why only days that CARRY
  // attendance link at all.
  const dayFixHref = MUSTER_CORRECT_ROLES.includes(ctx.role)
    ? (date: string) =>
        fixHref({ workerId, date, projectId: null, backHref: withFrom(monthAnchor) })
    : null;

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
        <WorkerAttendanceCalendar
          month={month}
          worker={data.worker}
          stdRate={data.stdRate}
          prevHref={prevHref}
          nextHref={nextHref}
          dayFixHref={dayFixHref}
        />
      </div>
    </PageShell>
  );
}
