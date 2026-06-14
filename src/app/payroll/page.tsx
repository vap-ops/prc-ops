// Spec 69 — PM-only DC payroll: subcontractor days pooled across work
// packages for a calendar period, rolled up by contractor → worker. Server
// Component: money is read via the admin client and rendered server-side,
// never entering a client bundle; requireRole(PM_ROLES) is the gate the SA
// screens never pass. Period is a zero-client-JS GET form (same pattern as
// /requests), defaulting to the current Bangkok month.

import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/detail-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/notices";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import {
  SECTION_HEADING,
  CARD,
  FIELD_INPUT,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
} from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import { formatThaiDate } from "@/lib/i18n/labels";
import { parsePayrollRange } from "@/lib/labor/payroll";
import { fetchPayrollReport } from "@/lib/labor/fetch-payroll";

export const metadata = { title: "ค่าแรง DC" };

function baht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

function formatDays(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

interface PayrollPageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  const ctx = await requireRole(PM_ROLES);
  const { from, to } = await searchParams;
  const range = parsePayrollRange(from, to, bangkokTodayIso());

  const admin = createAdminClient();
  const report = await fetchPayrollReport(admin, range);

  const exportHref = `/payroll/export?from=${range.from}&to=${range.to}`;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">ค่าแรง DC</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>ค่าแรง DC</h2>

        {/* Period — zero-client-JS GET form, defaults to the current month. */}
        <form
          method="get"
          className={`${CARD} mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end`}
        >
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ตั้งแต่
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ถึง
            <input
              type="date"
              name="to"
              defaultValue={range.to}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            ดูข้อมูล
          </button>
        </form>

        {report.workerCount === 0 ? (
          <EmptyNotice>ไม่มีบันทึกค่าแรงผู้รับเหมาในช่วงนี้</EmptyNotice>
        ) : (
          <>
            <div className={`${CARD} mb-4 flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <p className="text-ink-secondary text-xs">
                  {formatThaiDate(range.from)} – {formatThaiDate(range.to)}
                </p>
                <p className="text-ink text-xl font-bold">{baht(report.totalAmount)}</p>
                <p className="text-ink-secondary text-xs">
                  {report.workerCount} คน · {formatDays(report.totalDays)} วัน
                </p>
              </div>
              {/* Plain <a download>, NOT next/link — a prefetch must not fire
                  the export route. */}
              <a href={exportHref} download className={`${BUTTON_SECONDARY} shrink-0`}>
                ดาวน์โหลด CSV
              </a>
            </div>

            <ul className="flex flex-col gap-4">
              {report.contractors.map((g) => (
                <li key={g.contractorId ?? "unassigned"} className={CARD}>
                  <div className="border-edge mb-2 flex items-center justify-between gap-3 border-b pb-2">
                    <p className="text-ink min-w-0 truncate font-semibold">{g.contractorName}</p>
                    <p className="text-ink shrink-0 text-sm font-bold">{baht(g.amount)}</p>
                  </div>
                  <ul className="divide-edge flex flex-col divide-y">
                    {g.workers.map((w) => (
                      <li key={w.workerId} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="text-ink truncate text-sm font-medium">{w.name}</p>
                          <p className="text-ink-secondary text-xs">{formatDays(w.days)} วัน</p>
                        </div>
                        <span className="text-ink shrink-0 text-sm font-medium">
                          {baht(w.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </PageShell>
  );
}
