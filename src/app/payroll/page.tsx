// Spec 69 / spec 170 U3 / spec 266 U4 — PM-only ค่าแรง: daily-ช่าง days pooled
// across work packages for a calendar period, rolled up per worker (the payee ช่าง).
// Server Component: money is read via the admin client and rendered server-side,
// never entering a client bundle; requireRole(PM_ROLES) is the gate the SA
// screens never pass. Period is a zero-client-JS GET form (same pattern as
// /requests), defaulting to the current Bangkok month.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { ProjectLens } from "@/components/features/common/project-lens";
import { requireRole } from "@/lib/auth/require-role";
import { PAYROLL_ROLES, PAYROLL_VIEW_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { createClient as createServerClient } from "@/lib/db/server";
import {
  SECTION_HEADING,
  CARD,
  FIELD_INPUT,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
} from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import {
  formatThaiDate,
  PAYROLL_PAYMENT_PERIOD_WIDE_NOTE,
  PAYROLL_WHT_LABEL,
  PAYROLL_NET_LABEL,
} from "@/lib/i18n/labels";
import { parsePayrollRange } from "@/lib/labor/payroll";
import { fetchPayrollReport } from "@/lib/labor/fetch-payroll";
import {
  reconcilePayroll,
  WAGE_PAYMENT_METHOD_LABELS,
  type PaymentStatus,
} from "@/lib/labor/payments";
import { fetchPeriodPayments, fetchWorkerBanks } from "@/lib/labor/fetch-payments";
import { RecordPaymentSheet } from "@/components/features/labor/record-payment-sheet";
import { bahtUnit as baht } from "@/lib/format";

export const metadata = { title: "ค่าแรง" };

function formatDays(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

interface PayrollPageProps {
  searchParams: Promise<{ from?: string; to?: string; project?: string }>;
}

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  // Spec 187: procurement gains project-director parity here — it views the
  // ค่าแรง roll-up AND records payments (record_wage_payment admits it too).
  // Spec 252: accounting is admitted READ-ONLY (PAYROLL_VIEW_ROLES) — the record
  // affordance below stays keyed to the unwidened PAYROLL_ROLES, and the
  // record_wage_payment RPC refuses accounting regardless.
  const ctx = await requireRole(PAYROLL_VIEW_ROLES);
  const canRecord = PAYROLL_ROLES.includes(ctx.role);
  const { from, to, project } = await searchParams;
  const range = parsePayrollRange(from, to, bangkokTodayIso());
  const projectId = project || undefined;

  // Spec 309 — project options for the filter dropdown. Server RLS client:
  // project names are not money, and visibility mirrors the /workers assigner
  // (procurement sees all). The wage roll-up itself stays on the admin client.
  const supabase = await createServerClient();
  const { data: projectOptions } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code");

  const admin = createAdminClient();
  const report = await fetchPayrollReport(admin, range, projectId);

  // Spec 127 U2 / spec 170 U3 — annotate each worker with their recorded payment
  // for this exact period (paid/outstanding/drift). Spec 311 U5: reconciliation
  // is period-wide (wage_payments has no project dimension), so under a project
  // filter it is suppressed — skip the payment/bank reads and render a note.
  const reconciliation =
    projectId === undefined
      ? reconcilePayroll(report, await fetchPeriodPayments(admin, range), range, undefined)
      : reconcilePayroll(report, [], range, projectId);
  const annotated = reconciliation.scoped ? null : reconciliation.report;
  const workerIds = report.workers.map((w) => w.workerId);
  // Worker banks feed the record sheet's transfer target — only needed where the
  // record affordance renders (the unfiltered view).
  const banks = annotated ? await fetchWorkerBanks(admin, workerIds) : new Map<string, never>();
  // Spec 311 U5: per-worker payment lookup — populated only in the unfiltered
  // (all-projects) view; empty under a project filter.
  const paymentByWorker = new Map<string, PaymentStatus | null>();
  if (annotated) for (const w of annotated.workers) paymentByWorker.set(w.workerId, w.payment);
  const todayIso = bangkokTodayIso();

  const exportHref = `/payroll/export?from=${range.from}&to=${range.to}${
    projectId ? `&project=${projectId}` : ""
  }`;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">ค่าแรง</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>ค่าแรง</h2>

        {/* Spec 323 U5: the universal cross-project lens — one-tap scoping on the
            same ?project= axis the form's picker below writes (they stay in sync
            via the URL; the lens keeps the from/to period params). empty:hidden so
            the collapsed single-project state leaves no stray margin. Wages are
            project-blind by default (spec 311 P0); this gives them the lens. */}
        <div className="mb-4 empty:hidden">
          <ProjectLens
            projects={(projectOptions ?? []).map((p) => ({ id: p.id, name: p.name ?? p.code }))}
          />
        </div>

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
          {/* Spec 309 — scope the per-worker roll-up to one project (empty =
              every project, the original behaviour). Zero-JS: submits with the
              period on the same GET form. */}
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            โครงการ
            <select
              name="project"
              defaultValue={projectId ?? ""}
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

        {report.workerCount === 0 ? (
          <EmptyNotice>ไม่มีบันทึกค่าแรงในช่วงนี้</EmptyNotice>
        ) : (
          <>
            <div className={`${CARD} mb-4 flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <p className="text-ink-secondary text-xs">
                  {formatThaiDate(range.from)} – {formatThaiDate(range.to)}
                </p>
                <p className="text-ink text-xl font-bold">{baht(report.totalGross)}</p>
                {/* Spec 314 U4 — WHT / net breakdown, shown only when there is
                    withholding (all rows null-% → gross === net, no need). */}
                {report.totalWht > 0 ? (
                  <p className="text-ink-secondary text-xs">
                    {PAYROLL_WHT_LABEL} {baht(report.totalWht)} · {PAYROLL_NET_LABEL}{" "}
                    {baht(report.totalNet)}
                  </p>
                ) : null}
                <p className="text-ink-secondary text-xs">
                  {report.workerCount} คน · {formatDays(report.totalDays)} วัน
                </p>
                {annotated ? (
                  <p className="text-ink-secondary mt-0.5 text-xs">
                    จ่ายแล้ว {annotated.paidCount} ราย · ค้างจ่าย {annotated.unpaidCount} ราย
                    {annotated.outstandingAmount > 0
                      ? ` · ยอดค้าง ${baht(annotated.outstandingAmount)}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-ink-secondary mt-0.5 text-xs">
                    {PAYROLL_PAYMENT_PERIOD_WIDE_NOTE}
                  </p>
                )}
              </div>
              {/* Plain <a download>, NOT next/link — a prefetch must not fire
                  the export route. */}
              <a href={exportHref} download className={`${BUTTON_SECONDARY} shrink-0`}>
                ดาวน์โหลด CSV
              </a>
            </div>

            <ul className="flex flex-col gap-4">
              {report.workers.map((w) => {
                // Spec 311 U5: the per-worker payment block renders only in the
                // all-projects (unfiltered) view, where the roll-up and the
                // period-wide payment share scope.
                const payment = paymentByWorker.get(w.workerId) ?? null;
                return (
                  <li key={w.workerId} className={CARD}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink truncate font-semibold">{w.name}</p>
                        <p className="text-ink-secondary text-xs">{formatDays(w.days)} วัน</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-ink text-sm font-bold">{baht(w.gross)}</p>
                        {/* Spec 314 U4 — per-worker WHT / net split when withheld. */}
                        {w.wht > 0 ? (
                          <p className="text-ink-secondary text-xs">
                            {PAYROLL_WHT_LABEL} {baht(w.wht)} · {PAYROLL_NET_LABEL} {baht(w.net)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {/* Spec 127 U2 / spec 170 U3 — payment status: paid badge
                        (+ drift note) or the record affordance, per worker.
                        Suppressed under a project filter (spec 311 U5). */}
                    {annotated ? (
                      <div className="border-edge mt-2 border-t pt-3">
                        {payment ? (
                          <div className="flex flex-col gap-1.5">
                            <p className="text-done-strong text-xs font-medium">
                              จ่ายแล้ว {baht(payment.paidAmount)} · {formatThaiDate(payment.paidAt)}{" "}
                              · {WAGE_PAYMENT_METHOD_LABELS[payment.method]}
                            </p>
                            {payment.drifted ? (
                              <p className="rounded-control border-attn bg-attn-soft text-attn-ink border-l-4 px-3 py-2 text-xs font-medium">
                                ยอดค่าแรงเปลี่ยนไปหลังบันทึกการจ่าย (ยอดที่จ่ายอ้างอิง{" "}
                                {baht(payment.computedAmount)})
                              </p>
                            ) : null}
                          </div>
                        ) : canRecord ? (
                          <RecordPaymentSheet
                            workerId={w.workerId}
                            workerName={w.name}
                            from={range.from}
                            to={range.to}
                            computedAmount={w.gross}
                            computedDays={w.days}
                            bank={banks.get(w.workerId) ?? null}
                            todayIso={todayIso}
                            revalidate="/payroll"
                          />
                        ) : (
                          <p className="text-ink-muted text-xs">ยังไม่บันทึกการจ่าย</p>
                        )}
                      </div>
                    ) : null}
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
