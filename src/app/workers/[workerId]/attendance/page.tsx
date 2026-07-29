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
// so the back chip resolves ?from via safeBackHref (MULTI_PARENT_DETAILS pin).

import { notFound } from "next/navigation";

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";
import { safeBackHref } from "@/lib/nav/back-href";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { bangkokTodayIso } from "@/lib/dates";
import { addMonthsIso } from "@/lib/work-packages/calendar-grid";
import { ATTENDANCE_CALENDAR_LABEL, WORKER_ROSTER_LABEL } from "@/lib/i18n/labels";
import { buildAttendanceMonth } from "@/lib/attendance/attendance-month";
import { loadWorkerAttendance } from "@/lib/attendance/load-worker-attendance";
import { WorkerAttendanceCalendar } from "@/components/features/labor/worker-attendance-calendar";

export const metadata = { title: ATTENDANCE_CALENDAR_LABEL };

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function WorkerAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ workerId: string }>;
  searchParams: Promise<{ m?: string; from?: string }>;
}) {
  const { workerId } = await params;
  const { m, from } = await searchParams;
  const ctx = await requireRole(WORKER_ROSTER_ROLES);

  const monthAnchor = MONTH_PARAM.test(m ?? "") ? `${m}-01` : `${bangkokTodayIso().slice(0, 7)}-01`;

  const data = await loadWorkerAttendance(workerId, monthAnchor, ctx.role);
  if (!data) notFound();

  const month = buildAttendanceMonth({
    monthAnchor,
    musterRows: data.musterRows,
    paidRows: data.paidRows,
    dayRate: data.worker.dayRate,
  });

  // Month steppers must carry the referrer forward, or paging a month would
  // silently reset the back chip to the fallback parent.
  const base = `/workers/${workerId}/attendance`;
  const withFrom = (anchor: string) =>
    `${base}?m=${anchor.slice(0, 7)}${from ? `&from=${encodeURIComponent(from)}` : ""}`;
  const prevHref = withFrom(addMonthsIso(monthAnchor, -1));
  const nextHref = withFrom(addMonthsIso(monthAnchor, 1));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/workers")} backLabel={WORKER_ROSTER_LABEL}>
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
        />
      </div>
    </PageShell>
  );
}
