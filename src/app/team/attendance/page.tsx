// Spec 358 U2 — ประวัติการเช็คชื่อ: the office/payroll attendance AUDIT report.
//
// The muster cockpit answers "who is here TODAY" and is hard-locked to today's
// date; nothing answered "who was present over this month, and does the record
// look trustworthy". This page does, cross-project, for the office audience.
//
// Server Component. The read goes through `audit_attendance_summary`, a DEFINER
// RPC, on the RLS SESSION client — never the admin client: calling it under the
// user's JWT is what makes its role gate AND its can_see_project scoping (for
// project_manager) apply. muster_* RLS is can_see_project-scoped, which is FALSE
// for accounting/hr, which is why the RPC exists at all.
//
// RAW scan truth: presence, OT hours, and the audit signals. NO wages, no GL, no
// baht anywhere on this surface (spec 306 U5 owns the money derive). Period is a
// zero-client-JS GET form, the /payroll + /requests house pattern.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { safeBackHref } from "@/lib/nav/back-href";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { ATTENDANCE_AUDIT_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerClient } from "@/lib/db/server";
import { SECTION_HEADING, CARD, FIELD_INPUT, BUTTON_PRIMARY } from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import { ATTENDANCE_AUDIT_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import {
  attendanceRange,
  formatSignals,
  loadAttendanceSummary,
} from "@/lib/muster/attendance-audit";

export const metadata = { title: ATTENDANCE_AUDIT_LABEL };

function formatHours(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

interface AttendanceAuditPageProps {
  // ?start/?end = the audit range; ?from = the back-referrer (this page hangs off
  // BOTH /team and /accounting, so the parent is not derivable — the spec-334
  // multi-parent pattern, and the same param split /payroll settled on).
  searchParams: Promise<{
    start?: string | string[];
    end?: string | string[];
    project?: string | string[];
    from?: string | string[];
  }>;
}

export default async function AttendanceAuditPage({ searchParams }: AttendanceAuditPageProps) {
  const ctx = await requireRole(ATTENDANCE_AUDIT_ROLES);
  const { start, end, project, from } = await searchParams;
  const range = attendanceRange({ start, end, project }, bangkokTodayIso());

  const supabase = await createServerClient();
  const rows = await loadAttendanceSummary(supabase, range);

  // Project options for the lens: whatever this caller may already SELECT. The
  // senior/office roles see every project (can_see_project's see-all arm or the
  // RPC's own cross-project tier); a project_manager sees their memberships. A
  // caller with no project visibility still gets rows from the RPC, so the picker
  // is a convenience, never the gate.
  const { data: projectOptions } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code");

  const totalDays = rows.reduce((sum, r) => sum + r.daysPresent, 0);
  const totalOt = rows.reduce((sum, r) => sum + r.otHoursTotal, 0);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/team")} backLabel="ทีมงาน">
        <h1 className="text-title text-ink font-bold tracking-tight">{ATTENDANCE_AUDIT_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>{ATTENDANCE_AUDIT_LABEL}</h2>

        {/* Period + project — zero-client-JS GET form, defaults to this month. */}
        <form
          method="get"
          className={`${CARD} mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end`}
        >
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ตั้งแต่
            <input
              type="date"
              name="start"
              defaultValue={range.from}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ถึง
            <input
              type="date"
              name="end"
              defaultValue={range.to}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            โครงการ
            <select
              name="project"
              defaultValue={range.projectId ?? ""}
              className={`${FIELD_INPUT} mt-1 max-w-full`}
            >
              <option value="">ทุกโครงการ</option>
              {projectOptions?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code ? `${p.code} · ${p.name}` : p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            ดูข้อมูล
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyNotice>ไม่มีบันทึกการเช็คชื่อในช่วงนี้</EmptyNotice>
        ) : (
          <>
            <div className={`${CARD} mb-4`}>
              <p className="text-ink-secondary text-xs">
                {formatThaiDate(range.from)} – {formatThaiDate(range.to)}
              </p>
              <p className="text-ink mt-1 text-sm font-semibold">
                {rows.length} คน · รวม {formatDaysTotal(totalDays)} วัน
                {totalOt > 0 ? ` · OT ${formatHours(totalOt)} ชม.` : ""}
              </p>
            </div>

            {/* One row per worker. The signal chips mark the rows an auditor
                should look at — a clean row carries none. */}
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const signals = formatSignals(r);
                return (
                  <li key={r.workerId} className={CARD}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-ink min-w-0 text-sm font-semibold">{r.workerName}</span>
                      <span className="text-ink-secondary text-xs">
                        {r.daysPresent} วัน
                        {r.otHoursTotal > 0 ? ` · OT ${formatHours(r.otHoursTotal)} ชม.` : ""}
                        {r.projectCount > 1 ? ` · ${r.projectCount} โครงการ` : ""}
                      </span>
                    </div>
                    {signals.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {signals.map((s) => (
                          <li
                            key={s.key}
                            className="bg-sunk text-ink-secondary rounded-full px-2 py-0.5 text-[11px]"
                          >
                            {s.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </PageShell>
  );
}

function formatDaysTotal(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}
