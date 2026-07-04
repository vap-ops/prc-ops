// Spec 262 U2 — the report's drill target: a bucket×group row lands here on
// the underlying purchases for that exact slice. Same register-style list as
// /accounting/purchases, reusing its loader + pure view helpers directly
// (EXTRACT, don't copy — load-purchases.ts / purchases-view.ts). Read-only:
// no period/project form here — go back to the report to change the filter.

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASE_REPORT_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso, ISO_DATE_REGEX } from "@/lib/dates";
import { formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import {
  loadPurchaseRegister,
  type RegisterDimensionFilter,
} from "@/lib/accounting/load-purchases";
import {
  summarizePurchases,
  purchaseStatusLabel,
  purchaseRegisterCountLabel,
  groupRegisterByPo,
} from "@/lib/accounting/purchases-view";
import { PoNumberTag } from "@/components/features/purchasing/po-number-tag";
import { withBackFrom } from "@/lib/nav/back-href";

export const metadata = { title: "รายการจัดซื้อตามรายงาน" };

interface RegisterPageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    dim?: string;
    key?: string;
    unassigned?: string;
  }>;
}

const SLICE_DIMENSION_LABEL: Record<string, string> = {
  project: "โครงการ",
  supplier: "ผู้ขาย",
  category: "หมวดวัสดุ",
  purchaser: "ผู้สั่งซื้อ",
};

export default async function ReportRegisterPage({ searchParams }: RegisterPageProps) {
  const ctx = await requireRole(PURCHASE_REPORT_ROLES);
  const sp = await searchParams;
  const today = bangkokTodayIso();
  const from = sp.from && ISO_DATE_REGEX.test(sp.from) ? sp.from : today;
  const to = sp.to && ISO_DATE_REGEX.test(sp.to) ? sp.to : today;
  const unassigned = sp.unassigned === "1";
  const key = unassigned ? "" : (sp.key ?? "");

  let projectId: string | undefined;
  let slice: RegisterDimensionFilter | undefined;
  if (sp.dim === "project") {
    projectId = key || undefined;
  } else if (sp.dim === "supplier" || sp.dim === "category" || sp.dim === "purchaser") {
    slice = { dimension: sp.dim, key };
  }

  const admin = createAdminClient();
  const rows = await loadPurchaseRegister(admin, from, to, projectId, slice);
  const summary = summarizePurchases(rows);
  const groups = groupRegisterByPo(rows);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/requests/reports" backLabel="รายงาน">
        <h1 className="text-title text-ink font-bold tracking-tight">รายการจัดซื้อ</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <div className={`${CARD} mb-6`}>
          <p className="text-ink-secondary text-xs">
            {formatThaiDate(from)} – {formatThaiDate(to)}
            {sp.dim ? ` · ${SLICE_DIMENSION_LABEL[sp.dim] ?? sp.dim}` : ""} ·{" "}
            {purchaseRegisterCountLabel(summary.count)}
          </p>
          <dl className="divide-edge mt-2 flex flex-col divide-y">
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
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.poNumber ?? "no-po"}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  {group.poNumber !== null ? (
                    group.rows[0]?.poId ? (
                      <Link
                        href={withBackFrom(
                          `/requests/orders/${group.rows[0].poId}`,
                          "/requests/reports/register",
                        )}
                        className="focus-visible:ring-action rounded focus:outline-none focus-visible:ring-2"
                      >
                        <PoNumberTag poNumber={group.poNumber} />
                      </Link>
                    ) : (
                      <PoNumberTag poNumber={group.poNumber} />
                    )
                  ) : (
                    <span className="text-ink-secondary text-xs font-medium">
                      ซื้อตรง (ไม่มีใบสั่งซื้อ)
                    </span>
                  )}
                  <p className="text-ink-secondary text-xs tabular-nums">
                    รวม {baht(group.subtotalGross)}
                  </p>
                </div>
                <ul className="flex flex-col gap-2">
                  {group.rows.map((r) => (
                    <li key={r.id} className={CARD}>
                      {/* No further drill: the accounting voucher and the
                          purchasing worklist detail each gate out roles the
                          other admits (accounting excluded from one, site_admin
                          excluded from the other) — no single destination
                          covers all 6 report roles, so this row is terminal. */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-ink truncate text-sm font-medium">{r.supplierLabel}</p>
                          <p className="text-ink-muted text-xs">
                            {r.projectLabel} · {purchaseStatusLabel(r.status)}
                            {r.purchasedAt ? ` · ${formatThaiDate(r.purchasedAt)}` : ""}
                          </p>
                        </div>
                        <p className="text-ink shrink-0 text-sm font-bold tabular-nums">
                          {baht(r.gross)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
