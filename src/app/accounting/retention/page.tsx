// Spec 149 U9b — retention register: the client-withheld 5%, by status. Read-only
// for accounting; spec 204 adds the write path (mark due, release) for the billing-
// write roles. `open` (held + due) is what clients still owe us. Drills from /accounting.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD } from "@/lib/ui/classes";
import { loadRetentionRegister } from "@/lib/accounting/load-registers";
import { summarizeRetention } from "@/lib/accounting/register-summaries";
import { BILLING_WRITE_ROLES } from "@/lib/accounting/billing-actions";
import { RetentionRowActions } from "./retention-row-actions";

export const metadata = { title: "เงินประกันผลงาน" };

const STATUS_LABEL: Record<string, string> = {
  held: "ถือไว้",
  due: "ครบกำหนด",
  released: "คืนแล้ว",
  forfeited: "ริบ",
};

export default async function RetentionRegisterPage() {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const admin = createAdminClient();
  const rows = await loadRetentionRegister(admin);
  const s = summarizeRetention(rows);
  const canWrite = BILLING_WRITE_ROLES.includes(ctx.role);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">เงินประกันผลงาน</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <div className={`${CARD} mb-6`}>
          <p className="text-ink-secondary text-xs">ยังไม่ได้รับคืน (ถือไว้ + ครบกำหนด)</p>
          <p className="text-ink text-2xl font-bold">{baht(s.open)}</p>
          <p className="text-ink-secondary mt-1 text-xs">
            ถือไว้ {baht(s.held)} · ครบกำหนด {baht(s.due)} · คืนแล้ว {baht(s.released)}
          </p>
        </div>

        <h2 className={SECTION_HEADING}>รายการ</h2>
        {rows.length === 0 ? (
          <EmptyNotice>ยังไม่มีเงินประกันผลงาน</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id} className={CARD}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-semibold">{r.projectLabel}</p>
                    <p className="text-ink-secondary text-xs">
                      {STATUS_LABEL[r.status] ?? r.status}
                      {r.dueDate ? ` · ครบกำหนด ${formatThaiDate(r.dueDate)}` : ""}
                    </p>
                  </div>
                  <p className="text-ink shrink-0 text-sm font-bold tabular-nums">
                    {baht(r.amountWithheld)}
                  </p>
                </div>
                {canWrite ? <RetentionRowActions id={r.id} status={r.status} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
