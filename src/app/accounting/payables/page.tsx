// Spec 196 Tier 2 — AP subledger (เจ้าหนี้การค้า). The supplier roll-up behind the
// 2100 control total: who we owe and how much, each drilling into that supplier's
// statement (the 2100 ledger filtered to them). Gated to ACCOUNTING_ROLES; reads
// via admin behind the gate (the register pattern).

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
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import { loadPayables, AP_ACCOUNT_CODE } from "@/lib/accounting/load-payables";

export const metadata = { title: "เจ้าหนี้การค้า" };

export default async function PayablesPage() {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const admin = createAdminClient();
  const { rows, total } = await loadPayables(admin);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">เจ้าหนี้การค้า</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <div className={`${CARD} mb-6 flex items-center justify-between gap-3`}>
          <p className="text-ink-secondary text-sm">ยอดเจ้าหนี้คงค้าง</p>
          <p className="text-ink text-lg font-bold tabular-nums">{baht(total)}</p>
        </div>

        <h2 className={SECTION_HEADING}>รายผู้ขาย</h2>
        {rows.length === 0 ? (
          <EmptyNotice>ไม่มียอดค้างชำระเจ้าหนี้</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r, i) => {
              const amount = (
                <p className="text-ink text-sm font-bold tabular-nums">{baht(r.balance)}</p>
              );
              // A real supplier drills into its statement (the 2100 ledger for it);
              // the null-counterparty bucket has nothing to drill to.
              return (
                <li key={r.supplierId ?? `none-${i}`} className={CARD}>
                  {r.supplierId ? (
                    <Link
                      href={`/accounting/ledger?code=${AP_ACCOUNT_CODE}&supplier=${r.supplierId}`}
                      className="hover:bg-sunk focus-visible:ring-action -m-1 flex items-center justify-between gap-3 rounded-md p-1 transition-colors focus:outline-none focus-visible:ring-2"
                    >
                      <span className="text-ink min-w-0 truncate text-sm font-medium">
                        {r.supplierLabel}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {amount}
                        <ChevronRight aria-hidden className="text-ink-muted h-4 w-4" />
                      </span>
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink-secondary min-w-0 truncate text-sm">
                        {r.supplierLabel}
                      </span>
                      {amount}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
