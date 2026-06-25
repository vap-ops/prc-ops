// Spec 149 U9b — WHT certificate register (PND3/53/1), read-only. Drills from
// /accounting. deducted = we withheld (we owe the Revenue Dept); suffered = a
// client withheld from us (a tax asset).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { formatThaiDate } from "@/lib/i18n/labels";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import { loadWhtRegister, loadWhtFormData } from "@/lib/accounting/load-registers";
import { RecordWhtForm } from "./record-wht-form";

export const metadata = { title: "ภาษีหัก ณ ที่จ่าย" };

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DIRECTION_LABEL: Record<string, string> = {
  deducted: "เราหัก (ค้างนำส่ง)",
  suffered: "ถูกหัก (เครดิตภาษี)",
};
const FORM_LABEL: Record<string, string> = {
  pnd3: "ภ.ง.ด.3",
  pnd53: "ภ.ง.ด.53",
  pnd1: "ภ.ง.ด.1",
};

export default async function WhtRegisterPage() {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const admin = createAdminClient();
  // Among ACCOUNTING_ROLES reachers only super_admin is a manager — exactly the
  // journal-link gate. Load the form pickers only for writers (parallel, no
  // waterfall).
  const canWrite = isManagerRole(ctx.role);
  const [rows, formData] = await Promise.all([
    loadWhtRegister(admin),
    canWrite ? loadWhtFormData(admin) : Promise.resolve(null),
  ]);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">ภาษีหัก ณ ที่จ่าย</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {canWrite && formData ? <RecordWhtForm data={formData} /> : null}

        <h2 className={SECTION_HEADING}>ใบหักภาษี ณ ที่จ่าย</h2>
        {rows.length === 0 ? (
          <EmptyNotice>ยังไม่มีใบหักภาษี ณ ที่จ่าย</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id} className={`${CARD} flex items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <p className="text-ink truncate text-sm font-semibold">{r.partyLabel}</p>
                  <p className="text-ink-secondary text-xs">
                    {DIRECTION_LABEL[r.direction] ?? r.direction} ·{" "}
                    {FORM_LABEL[r.taxForm] ?? r.taxForm}
                    {" · "}
                    {Number(r.whtRate)}%
                  </p>
                  <p className="text-ink-muted text-xs">
                    #{r.certNo} · {formatThaiDate(r.issuedDate)} · ฐาน {baht(r.baseAmount)}
                  </p>
                </div>
                <p className="text-ink shrink-0 text-sm font-bold tabular-nums">
                  {baht(r.whtAmount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
