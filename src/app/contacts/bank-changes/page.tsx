// Spec 186 U1 — the contractor bank-change approval queue. The aggregate view
// behind the dashboard's bank-change awareness card: every pending change in one
// place with an inline approve/reject, instead of hunting through the contractor
// list. Bank fields are money (zero authenticated grant) → admin-read behind the
// requireRole(PM_ROLES) gate, exactly like the contractor detail page. Deciders
// are pm/super/director (the decide RPC gate); procurement is excluded.

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { BankChangeDecision } from "@/components/features/portal/bank-change-decision";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { buildBankChangeQueue } from "@/lib/approvals/bank-change-queue";
import { formatThaiDateTime } from "@/lib/i18n/labels";

export const metadata = { title: "การเปลี่ยนบัญชีรอการอนุมัติ" };

const REVALIDATE = "/contacts/bank-changes";

export default async function BankChangeQueuePage() {
  const ctx = await requireRole(PM_ROLES);
  const admin = createAdminSupabase();

  const { data: requests } = await admin
    .from("contractor_bank_change_requests")
    .select("id, contractor_id, bank_name, bank_account_no, bank_account_name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const rows = requests ?? [];

  const contractorIds = Array.from(new Set(rows.map((r) => r.contractor_id)));
  const { data: contractors } = contractorIds.length
    ? await admin.from("contractors").select("id, name").in("id", contractorIds)
    : { data: [] };
  const namesById = new Map((contractors ?? []).map((c) => [c.id, c.name]));

  const items = buildBankChangeQueue(rows, namesById);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/dashboard" backLabel="กลับไปหน้าภาพรวม">
        <h1 className="text-ink text-xl font-semibold tracking-tight">
          การเปลี่ยนบัญชีธนาคารรอการอนุมัติ
        </h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {items.length === 0 ? (
          <EmptyNotice>ไม่มีรายการรอการอนุมัติ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((it) => (
              <li key={it.id} className="rounded-card border-edge bg-card shadow-card border p-4">
                <p className="text-ink text-base font-semibold break-words">{it.contractorName}</p>
                <dl className="text-ink-secondary mt-2 space-y-0.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="text-ink-muted w-20 shrink-0">ธนาคาร</dt>
                    <dd>{it.bankName ?? "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-ink-muted w-20 shrink-0">ชื่อบัญชี</dt>
                    <dd>{it.accountName ?? "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-ink-muted w-20 shrink-0">เลขบัญชี</dt>
                    <dd className="font-mono">{it.accountNo ?? "—"}</dd>
                  </div>
                </dl>
                <p className="text-ink-muted mt-2 text-xs">
                  ส่งคำขอเมื่อ {formatThaiDateTime(it.createdAt)}
                </p>
                <div className="mt-3">
                  <BankChangeDecision requestId={it.id} revalidate={REVALIDATE} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
