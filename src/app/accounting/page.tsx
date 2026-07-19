// Spec 149 U9 — /accounting: the read-only ledger surface (trial balance,
// reconciliation, P&L). Server Component; the GL RPCs are SECURITY DEFINER gated
// pm/super/accounting, so they run on the AUTHENTICATED session (NOT the admin
// client — service-role has a NULL role the gate refuses). Money renders
// server-side to money-cleared roles only (the page gate excludes site_admin,
// spec 46). Period is a zero-client-JS GET form defaulting to the current month.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { COMPANY_DOCS_HINT, COMPANY_DOCS_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD, FIELD_INPUT, BUTTON_PRIMARY } from "@/lib/ui/classes";
import { loadAccountingDashboard } from "@/lib/accounting/load-dashboard";
import {
  groupTrialBalance,
  profitAndLoss,
  type GlClass,
} from "@/lib/accounting/trial-balance-view";

export const metadata = { title: "บัญชี" };

const CLASS_LABELS: Record<GlClass, string> = {
  asset: "สินทรัพย์",
  liability: "หนี้สิน",
  equity: "ส่วนของเจ้าของ",
  income: "รายได้",
  expense: "ค่าใช้จ่าย",
};
const CLASS_ORDER: GlClass[] = ["asset", "liability", "equity", "income", "expense"];

const CHECK_LABELS: Record<string, string> = {
  trial_balance_balanced: "งบทดลองสมดุล (เดบิต = เครดิต)",
  retention_receivable_1210: "เงินประกันผลงานคงเหลือ ↔ บัญชีคุม",
  wht_payable_2210: "ภาษีหัก ณ ที่จ่ายค้างนำส่ง ↔ ใบหัก",
  wht_prepaid_1310: "ภาษีถูกหักรอเครดิต ↔ งวดงาน",
  output_vat_2200: "ภาษีขาย ↔ งวดงาน",
  posting_backlog: "รายการรอลงบัญชี (ต้องเป็น 0)",
};

interface AccountingPageProps {
  searchParams: Promise<{ from?: string; to?: string; project?: string }>;
}

export default async function AccountingPage({ searchParams }: AccountingPageProps) {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const { from: qFrom, to: qTo, project: qProject } = await searchParams;
  const today = bangkokTodayIso();
  const from = qFrom || `${today.slice(0, 7)}-01`;
  const to = qTo || today;
  const projectId = qProject || undefined;

  const supabase = await createClient();
  // Project list for the picker — read via admin (the accounting role isn't a
  // project member, so RLS would hide them; gl_trial_balance scopes by id anyway).
  const admin = createAdminClient();
  const { data: projectRows } = await admin.from("projects").select("id, code, name").order("name");
  const projects = projectRows ?? [];
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;
  const scopeLabel = selectedProject ? ` · ${selectedProject.name ?? selectedProject.code}` : "";

  const { trialBalance, reconciliation } = await loadAccountingDashboard(
    supabase,
    from,
    to,
    projectId,
  );
  const grouped = groupTrialBalance(trialBalance);
  const pl = profitAndLoss(trialBalance);

  // Spec 196 Tier 1: each trial-balance account drills into its ledger (the posted
  // lines behind the total), carrying the current period + project scope.
  const ledgerHref = (accountCode: string) => {
    const q = new URLSearchParams({ code: accountCode, from, to });
    if (projectId) q.set("project", projectId);
    return `/accounting/ledger?${q.toString()}`;
  };

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">บัญชี</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {/* Reconciliation — the books prove themselves. */}
        <h2 className={SECTION_HEADING}>การกระทบยอด</h2>
        <ul className={`${CARD} divide-edge mb-6 flex flex-col divide-y`}>
          {reconciliation.map((c) => (
            <li key={c.check_name} className="flex items-center justify-between gap-3 py-2">
              <p className="text-ink min-w-0 truncate text-sm">
                {CHECK_LABELS[c.check_name] ?? c.check_name}
              </p>
              {c.ok ? (
                <span className="text-done-strong shrink-0 text-sm font-semibold">✓ ตรง</span>
              ) : (
                <span className="rounded-control border-attn bg-attn-soft text-attn-ink shrink-0 border-l-4 px-2 py-0.5 text-xs font-semibold">
                  ต่าง {baht(Number(c.drift))}
                </span>
              )}
            </li>
          ))}
        </ul>

        {/* Registers — the detail lists behind the ledger. */}
        <h2 className={SECTION_HEADING}>ทะเบียน</h2>
        <nav className="mb-6 flex flex-col gap-2">
          {[
            // Spec 253: the per-project finance drill — quotation → PO → contract/
            // งวดเบิก → billed → received in one place.
            {
              href: "/accounting/projects",
              label: "การเงินรายโครงการ",
              hint: "สัญญา งวดเบิก วางบิล เงินรับ รายโครงการ",
            },
            { href: "/accounting/billings", label: "งวดงาน", hint: "การวางบิลลูกค้า" },
            {
              href: "/accounting/retention",
              label: "เงินประกันผลงาน",
              hint: "เงิน 5% ที่ลูกค้าหักไว้",
            },
            { href: "/accounting/wht", label: "ภาษีหัก ณ ที่จ่าย", hint: "ใบ ภ.ง.ด.3/53/1" },
            // Spec 196 Tier 2: the AP subledger behind the 2100 control total.
            { href: "/accounting/payables", label: "เจ้าหนี้การค้า", hint: "ยอดค้างชำระรายผู้ขาย" },
            // Spec 196 Tier 3: purchase register → voucher (source docs + GL entry).
            { href: "/accounting/purchases", label: "การจัดซื้อ", hint: "ตรวจสอบเอกสารการซื้อ" },
            // Spec 196 Tier 4: month-end close (open → closing → closed → locked).
            { href: "/accounting/periods", label: "ปิดงวดบัญชี", hint: "เปิด/ปิดงวดบัญชีรายเดือน" },
            // Spec 329: the firm's document library lives under settings, but
            // accounting are its primary users — their home advertises it.
            {
              href: "/settings/company-docs",
              label: COMPANY_DOCS_LABEL,
              hint: COMPANY_DOCS_HINT,
            },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-control flex items-center gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
            >
              <span className="min-w-0 flex-1">
                <span className="text-ink text-body block font-semibold">{l.label}</span>
                <span className="text-ink-secondary text-meta block">{l.hint}</span>
              </span>
              <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
            </Link>
          ))}
        </nav>

        {/* Manual general journal (gap G8) — a WRITE surface gated to PM_ROLES, so
            it is shown only to managers (super_admin among accounting-reachers);
            accounting-role can't post per the RPC, so it gets no dead link. */}
        {isManagerRole(ctx.role) ? (
          <Link
            href="/accounting/journal"
            className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-control mb-6 flex items-center gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
          >
            <span className="min-w-0 flex-1">
              <span className="text-ink text-body block font-semibold">สมุดรายวันทั่วไป</span>
              <span className="text-ink-secondary text-meta block">
                บันทึก/กลับรายการบัญชีด้วยตนเอง
              </span>
            </span>
            <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
          </Link>
        ) : null}

        {/* Period selector — zero-client-JS GET form, defaults to the month. */}
        <form
          method="get"
          className={`${CARD} mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end`}
        >
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ตั้งแต่
            <input
              type="date"
              name="from"
              defaultValue={from}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ถึง
            <input
              type="date"
              name="to"
              defaultValue={to}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            โครงการ
            <select
              name="project"
              defaultValue={projectId ?? ""}
              className={`${FIELD_INPUT} mt-1 max-w-full`}
            >
              <option value="">ทุกโครงการ</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.code}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            ดูข้อมูล
          </button>
        </form>

        {/* P&L summary for the period (project-scoped when picked). */}
        <h2 className={SECTION_HEADING}>กำไร–ขาดทุน{scopeLabel}</h2>
        <div className={`${CARD} mb-6`}>
          <p className="text-ink-secondary text-xs">
            {formatThaiDate(from)} – {formatThaiDate(to)}
          </p>
          <dl className="divide-edge mt-2 flex flex-col divide-y">
            <div className="flex items-center justify-between py-2">
              <dt className="text-ink text-sm">รายได้</dt>
              <dd className="text-ink text-sm font-medium">{baht(pl.income)}</dd>
            </div>
            <div className="flex items-center justify-between py-2">
              <dt className="text-ink text-sm">ค่าใช้จ่าย</dt>
              <dd className="text-ink text-sm font-medium">{baht(pl.expense)}</dd>
            </div>
            <div className="flex items-center justify-between py-2">
              <dt className="text-ink text-sm font-semibold">กำไรสุทธิ</dt>
              <dd className="text-ink text-base font-bold">{baht(pl.netProfit)}</dd>
            </div>
          </dl>
        </div>

        {/* Trial balance, grouped by account class (project-scoped when picked). */}
        <h2 className={SECTION_HEADING}>
          งบทดลอง{scopeLabel}{" "}
          {grouped.balanced ? (
            <span className="text-done-strong text-xs font-semibold">· สมดุล</span>
          ) : (
            <span className="text-attn-ink text-xs font-semibold">· ไม่สมดุล</span>
          )}
        </h2>

        {trialBalance.length === 0 ? (
          <EmptyNotice>ไม่มีรายการบัญชีในช่วงนี้</EmptyNotice>
        ) : (
          <div className="flex flex-col gap-4">
            {CLASS_ORDER.filter((cls) => grouped.sections[cls].length > 0).map((cls) => (
              <div key={cls} className={CARD}>
                <div className="border-edge mb-2 flex items-center justify-between gap-3 border-b pb-2">
                  <p className="text-ink font-semibold">{CLASS_LABELS[cls]}</p>
                  <p className="text-ink-secondary shrink-0 text-xs">เดบิต / เครดิต</p>
                </div>
                <ul className="divide-edge flex flex-col divide-y">
                  {grouped.sections[cls].map((row) => (
                    <li key={row.code}>
                      <Link
                        href={ledgerHref(row.code)}
                        className="hover:bg-sunk focus-visible:ring-action -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors focus:outline-none focus-visible:ring-2"
                      >
                        <div className="min-w-0">
                          <p className="text-ink truncate text-sm font-medium">{row.nameTh}</p>
                          <p className="text-ink-muted text-xs">{row.code}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 text-right">
                          <div>
                            <p className="text-ink text-sm font-medium tabular-nums">
                              {row.debitTotal > 0 ? baht(row.debitTotal) : "—"}
                            </p>
                            <p className="text-ink-secondary text-xs tabular-nums">
                              {row.creditTotal > 0 ? baht(row.creditTotal) : "—"}
                            </p>
                          </div>
                          <ChevronRight aria-hidden className="text-ink-muted h-4 w-4 shrink-0" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className={`${CARD} flex items-center justify-between gap-3`}>
              <p className="text-ink font-semibold">รวม</p>
              <div className="shrink-0 text-right">
                <p className="text-ink text-sm font-bold tabular-nums">
                  {baht(grouped.totalDebit)}
                </p>
                <p className="text-ink-secondary text-xs tabular-nums">
                  {baht(grouped.totalCredit)}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
