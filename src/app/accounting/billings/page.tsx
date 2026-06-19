// Spec 149 U9b — client-billing (งวด) register, read-only. Drills from /accounting.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { formatThaiDate } from "@/lib/i18n/labels";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import { loadBillingRegister } from "@/lib/accounting/load-registers";

export const metadata = { title: "งวดงาน" };

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, string> = {
  draft: "ร่าง",
  submitted: "ยื่นแล้ว",
  certified: "รับรองแล้ว",
  invoiced: "วางบิลแล้ว",
  paid: "รับเงินแล้ว",
};

export default async function BillingRegisterPage() {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const admin = createAdminClient();
  const rows = await loadBillingRegister(admin);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">งวดงาน</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>รายการวางบิลลูกค้า</h2>
        {rows.length === 0 ? (
          <EmptyNotice>ยังไม่มีงวดงาน</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id} className={CARD}>
                <div className="border-edge mb-2 flex items-center justify-between gap-3 border-b pb-2">
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-semibold">{r.projectLabel}</p>
                    <p className="text-ink-muted text-xs">
                      งวด #{r.billingNo} · {STATUS_LABEL[r.status] ?? r.status}
                      {r.certifiedAt ? ` · ${formatThaiDate(r.certifiedAt)}` : ""}
                    </p>
                  </div>
                  <p className="text-ink shrink-0 text-sm font-bold tabular-nums">
                    {baht(r.grossAmount)}
                  </p>
                </div>
                <div className="text-ink-secondary flex justify-between gap-3 text-xs">
                  <span>
                    หักประกัน {r.retentionAmount === null ? "—" : baht(r.retentionAmount)}
                  </span>
                  <span>รับสุทธิ {r.netReceivable === null ? "—" : baht(r.netReceivable)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
