// Spec 69 / spec 170 U3 — PM-only DC payroll: DC days pooled across work
// packages for a calendar period, rolled up per worker (the payee, ADR 0062).
// Server Component: money is read via the admin client and rendered server-side,
// never entering a client bundle; requireRole(PM_ROLES) is the gate the SA
// screens never pass. Period is a zero-client-JS GET form (same pattern as
// /requests), defaulting to the current Bangkok month.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
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
import { annotatePayrollPayments, DC_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import { fetchPeriodPayments, fetchWorkerBanks } from "@/lib/labor/fetch-payments";
import { RecordPaymentSheet } from "@/components/features/labor/record-payment-sheet";

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

  // Spec 127 U2 / spec 170 U3 — annotate each worker with their recorded payment
  // for this exact period (paid/outstanding/drift). Worker banks for the record
  // sheet's transfer target are batch-read (admin client; PM-gated page).
  const payments = await fetchPeriodPayments(admin, range);
  const workerIds = report.workers.map((w) => w.workerId);
  const banks = await fetchWorkerBanks(admin, workerIds);
  const annotated = annotatePayrollPayments(report, payments, range);
  const todayIso = bangkokTodayIso();

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
          <EmptyNotice>ไม่มีบันทึกค่าแรง DC ในช่วงนี้</EmptyNotice>
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
                <p className="text-ink-secondary mt-0.5 text-xs">
                  จ่ายแล้ว {annotated.paidCount} ราย · ค้างจ่าย {annotated.unpaidCount} ราย
                  {annotated.outstandingAmount > 0
                    ? ` · ยอดค้าง ${baht(annotated.outstandingAmount)}`
                    : ""}
                </p>
              </div>
              {/* Plain <a download>, NOT next/link — a prefetch must not fire
                  the export route. */}
              <a href={exportHref} download className={`${BUTTON_SECONDARY} shrink-0`}>
                ดาวน์โหลด CSV
              </a>
            </div>

            <ul className="flex flex-col gap-4">
              {annotated.workers.map((w) => (
                <li key={w.workerId} className={CARD}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink truncate font-semibold">{w.name}</p>
                      <p className="text-ink-secondary text-xs">{formatDays(w.days)} วัน</p>
                    </div>
                    <p className="text-ink shrink-0 text-sm font-bold">{baht(w.amount)}</p>
                  </div>

                  {/* Spec 127 U2 / spec 170 U3 — payment status: paid badge
                      (+ drift note) or the record affordance, per worker. */}
                  <div className="border-edge mt-2 border-t pt-3">
                    {w.payment ? (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-done-strong text-xs font-medium">
                          จ่ายแล้ว {baht(w.payment.paidAmount)} · {formatThaiDate(w.payment.paidAt)}{" "}
                          · {DC_PAYMENT_METHOD_LABELS[w.payment.method]}
                        </p>
                        {w.payment.drifted ? (
                          <p className="rounded-control border-attn bg-attn-soft text-attn-ink border-l-4 px-3 py-2 text-xs font-medium">
                            ยอดค่าแรงเปลี่ยนไปหลังบันทึกการจ่าย (ยอดที่จ่ายอ้างอิง{" "}
                            {baht(w.payment.computedAmount)})
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <RecordPaymentSheet
                        workerId={w.workerId}
                        workerName={w.name}
                        from={range.from}
                        to={range.to}
                        computedAmount={w.amount}
                        computedDays={w.days}
                        bank={banks.get(w.workerId) ?? null}
                        todayIso={todayIso}
                        revalidate="/payroll"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </PageShell>
  );
}
