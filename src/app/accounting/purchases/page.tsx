// Spec 196 Tier 3 (U5) — accounting purchase register. The purchases that posted
// to the GL in a period: supplier, amount, status, project — each drilling into
// its voucher (source documents + the GL entry). Gated to ACCOUNTING_ROLES; reads
// via admin behind the gate.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD, FIELD_INPUT, BUTTON_PRIMARY } from "@/lib/ui/classes";
import { loadPurchaseRegister } from "@/lib/accounting/load-purchases";
import {
  summarizePurchases,
  purchaseStatusLabel,
  purchaseRegisterCountLabel,
} from "@/lib/accounting/purchases-view";

export const metadata = { title: "การจัดซื้อ" };

interface PurchasesPageProps {
  searchParams: Promise<{ from?: string; to?: string; project?: string }>;
}

export default async function PurchasesPage({ searchParams }: PurchasesPageProps) {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const { from: qFrom, to: qTo, project: qProject } = await searchParams;
  const today = bangkokTodayIso();
  const from = qFrom || `${today.slice(0, 7)}-01`;
  const to = qTo || today;
  const projectId = qProject || undefined;

  const admin = createAdminClient();
  const { data: projectRows } = await admin.from("projects").select("id, code, name").order("name");
  const projects = projectRows ?? [];

  const rows = await loadPurchaseRegister(admin, from, to, projectId);
  const summary = summarizePurchases(rows);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">การจัดซื้อ</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {/* Period + project scope. */}
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

        {/* Period totals (gross / VAT / net). */}
        <div className={`${CARD} mb-6`}>
          <p className="text-ink-secondary text-xs">
            {formatThaiDate(from)} – {formatThaiDate(to)} ·{" "}
            {purchaseRegisterCountLabel(summary.count)}
          </p>
          <dl className="divide-edge mt-2 flex flex-col divide-y">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink-secondary text-sm">มูลค่าก่อนภาษี</dt>
              <dd className="text-ink text-sm font-medium tabular-nums">
                {baht(summary.totalNet)}
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink-secondary text-sm">ภาษีมูลค่าเพิ่ม</dt>
              <dd className="text-ink text-sm font-medium tabular-nums">
                {baht(summary.totalVat)}
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ink text-sm font-semibold">รวมทั้งสิ้น</dt>
              <dd className="text-ink text-base font-bold tabular-nums">
                {baht(summary.totalGross)}
              </dd>
            </div>
          </dl>
        </div>

        <h2 className={SECTION_HEADING}>รายการจัดซื้อ</h2>
        {rows.length === 0 ? (
          <EmptyNotice>ไม่มีการจัดซื้อในช่วงนี้</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id} className={CARD}>
                <Link
                  href={`/accounting/purchases/${r.id}`}
                  className="hover:bg-sunk focus-visible:ring-action -m-1 flex items-center justify-between gap-3 rounded-md p-1 transition-colors focus:outline-none focus-visible:ring-2"
                >
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-medium">{r.supplierLabel}</p>
                    <p className="text-ink-muted text-xs">
                      {r.projectLabel} · {purchaseStatusLabel(r.status)}
                      {r.purchasedAt ? ` · ${formatThaiDate(r.purchasedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <p className="text-ink text-sm font-bold tabular-nums">{baht(r.gross)}</p>
                    <ChevronRight aria-hidden className="text-ink-muted h-4 w-4" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
