// Spec 149 U9b — client-billing (งวด) register. Spec 204 adds the write path
// (create a draft claim + certify it) for the billing-write roles; the read view is
// unchanged for accounting. Certify books AR/revenue/VAT/WHT and accrues retention.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { SECTION_HEADING, CARD, BUTTON_PRIMARY_COMPACT } from "@/lib/ui/classes";
import { loadBillingRegister } from "@/lib/accounting/load-registers";
import { canCertifyBilling, BILLING_WRITE_ROLES } from "@/lib/accounting/billing-actions";
import { CreateBillingForm } from "./create-billing-form";
import { certifyClientBilling } from "./actions";

export const metadata = { title: "งวดงาน" };

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
  // In beta only super_admin is in both ACCOUNTING_ROLES and BILLING_WRITE_ROLES, so
  // accounting sees read-only; when spec 166 re-adds PM to the page gate the write
  // controls light up automatically (the action/RPC already admit pm).
  const canWrite = BILLING_WRITE_ROLES.includes(ctx.role);

  // Parallel reads (no waterfall, spec 147/148): the register + the project picker
  // (writers only — the create form needs it) + the งวด options per project
  // (spec 250 U2 — installments joined through their contract's project).
  const [rows, projectRes, installmentRes] = await Promise.all([
    loadBillingRegister(admin),
    canWrite ? admin.from("projects").select("id, code, name").order("code") : null,
    canWrite
      ? admin
          .from("contract_installments")
          .select("id, seq, label, amount, project_contracts ( project_id )")
          .order("seq")
      : null,
  ]);
  const projects = (projectRes?.data ?? []).map((p) => ({ id: p.id, label: p.name ?? p.code }));
  const installmentsByProject: Record<string, { id: string; label: string; amount: number }[]> = {};
  for (const i of installmentRes?.data ?? []) {
    const projectId = i.project_contracts?.project_id;
    if (!projectId) continue;
    (installmentsByProject[projectId] ??= []).push({
      id: i.id,
      label: i.label,
      amount: Number(i.amount),
    });
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-title text-ink font-bold tracking-tight">งวดงาน</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {canWrite ? (
          <CreateBillingForm projects={projects} installmentsByProject={installmentsByProject} />
        ) : null}

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
                {canWrite && canCertifyBilling(r.status) ? (
                  <div className="border-edge mt-3 flex justify-end border-t pt-3">
                    <ConfirmActionButton
                      idleLabel="รับรองงวด"
                      pendingLabel="กำลังรับรอง…"
                      confirmMessage="รับรองงวดนี้? ระบบจะลงบัญชีรายได้ + ภาษี และตั้งเงินประกันค้างรับ"
                      confirmLabel="รับรอง"
                      buttonClassName={BUTTON_PRIMARY_COMPACT}
                      action={certifyClientBilling.bind(null, r.id)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
