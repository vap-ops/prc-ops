// Spec 196 Tier 1 — GL ledger drill. Accounting taps an account on the trial
// balance and lands here: every posted journal line that hit it over the period,
// with the source document + counterparty, plus a debit/credit/net total. The
// vouching primitive — trace a trial-balance number down to the postings behind
// it. Gated to ACCOUNTING_ROLES (money, spec 46); reads via admin behind the gate.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { formatThaiDate } from "@/lib/i18n/labels";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import { loadAccountLedger } from "@/lib/accounting/load-ledger";
import { summarizeLedger } from "@/lib/accounting/ledger-view";

export const metadata = { title: "บัญชีแยกประเภท" };

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface LedgerPageProps {
  searchParams: Promise<{
    code?: string;
    from?: string;
    to?: string;
    project?: string;
    supplier?: string;
  }>;
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const { code, from: qFrom, to: qTo, project: qProject, supplier: qSupplier } = await searchParams;
  const today = bangkokTodayIso();
  const supplierId = qSupplier || undefined;
  // A supplier-scoped drill is the AP statement — its total must reconcile to the
  // (all-time) payables balance, so default the window to full history, not the
  // month. An account drill from the trial balance keeps the period it came from.
  const from = qFrom || (supplierId ? "2000-01-01" : `${today.slice(0, 7)}-01`);
  const to = qTo || today;
  const projectId = qProject || undefined;

  const admin = createAdminClient();
  const { account, rows } = code
    ? await loadAccountLedger(admin, code, from, to, projectId, supplierId)
    : { account: null, rows: [] };
  const totals = summarizeLedger(rows);

  // A supplier-scoped drill (Tier 2: AP statement) returns to the payables
  // register; otherwise back to the trial balance on the same period/scope.
  const supplierLabel = supplierId
    ? (rows.find((r) => r.supplierLabel)?.supplierLabel ?? null)
    : null;
  let backHref: string;
  let backLabel: string;
  if (supplierId) {
    backHref = "/accounting/payables";
    backLabel = "เจ้าหนี้การค้า";
  } else {
    const backQuery = new URLSearchParams({ from, to });
    if (projectId) backQuery.set("project", projectId);
    backHref = `/accounting?${backQuery.toString()}`;
    backLabel = "งบทดลอง";
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={backHref} backLabel={backLabel}>
        <h1 className="text-title text-ink font-bold tracking-tight">บัญชีแยกประเภท</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {!account ? (
          <EmptyNotice>ไม่พบบัญชีที่เลือก</EmptyNotice>
        ) : (
          <>
            <div className={`${CARD} mb-6`}>
              <p className="text-ink font-semibold">
                {account.nameTh}
                {supplierLabel ? (
                  <span className="text-ink-secondary font-normal"> · {supplierLabel}</span>
                ) : null}
              </p>
              <p className="text-ink-muted text-xs">
                {account.code} · {formatThaiDate(from)} – {formatThaiDate(to)}
              </p>
              <dl className="divide-edge mt-3 flex flex-col divide-y">
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-ink-secondary text-sm">เดบิตรวม</dt>
                  <dd className="text-ink text-sm font-medium tabular-nums">
                    {baht(totals.totalDebit)}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-ink-secondary text-sm">เครดิตรวม</dt>
                  <dd className="text-ink text-sm font-medium tabular-nums">
                    {baht(totals.totalCredit)}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-ink text-sm font-semibold">ยอดสุทธิ</dt>
                  <dd className="text-ink text-base font-bold tabular-nums">{baht(totals.net)}</dd>
                </div>
              </dl>
            </div>

            <h2 className={SECTION_HEADING}>รายการลงบัญชี</h2>
            {rows.length === 0 ? (
              <EmptyNotice>ไม่มีรายการในช่วงนี้</EmptyNotice>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((r, i) => (
                  <li key={`${r.entryNo}-${i}`} className={CARD}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink truncate text-sm font-medium">
                          {r.sourceLabel}
                          {r.supplierLabel ? (
                            <span className="text-ink-secondary font-normal">
                              {" "}
                              · {r.supplierLabel}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-ink-muted text-xs">
                          #{r.entryNo} · {formatThaiDate(r.entryDate)}
                          {r.memo ? ` · ${r.memo}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-ink text-sm font-medium tabular-nums">
                          {r.debit > 0 ? baht(r.debit) : "—"}
                        </p>
                        <p className="text-ink-secondary text-xs tabular-nums">
                          {r.credit > 0 ? baht(r.credit) : "—"}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </PageShell>
  );
}
