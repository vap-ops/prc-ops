// Spec 298 U3 — the PM completion queue. Workers an SA added phoneless (spec 298 U2)
// carry a capture-blind passbook photo in the walled sa-bank-capture/ store; here a
// money-authorized approver reads each passbook (a signed image) and transcribes the
// bank into workers.bank_* via complete_worker_bank. Gate = STAFF_APPROVAL_ROLES — the
// SAME set as the approve queue + the RPC's inline literal (route gate MUST equal the
// data gate). The worker_bank_capture rows + the passbook are read ONLY through the
// service-role admin client (listWorkersAwaitingBank) — never a field-role RLS session.

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { STAFF_APPROVAL_ROLES } from "@/lib/auth/role-home";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { EmptyNotice } from "@/components/features/common/notices";
import { listWorkersAwaitingBank } from "@/lib/register/worker-bank-queue";
import { WorkerBankCompleteForm } from "@/components/features/register/worker-bank-complete-form";
import { AWAITING_BANK_TITLE } from "@/lib/i18n/labels";

export const metadata = { title: AWAITING_BANK_TITLE };

export default async function AwaitingBankPage() {
  await requireRole(STAFF_APPROVAL_ROLES);
  const rows = await listWorkersAwaitingBank();

  return (
    <PageShell>
      <DetailHeader backHref="/registrations" backLabel="กลับ">
        <h1 className="text-ink text-xl font-semibold tracking-tight">{AWAITING_BANK_TITLE}</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          ช่างที่ถูกเพิ่มแบบไม่มีมือถือและถ่ายรูปสมุดบัญชีไว้ —
          กรอกเลขบัญชีจากรูปเพื่อให้จ่ายค่าจ้างได้
        </p>
        {rows.length === 0 ? (
          <EmptyNotice>ไม่มีช่างที่รอกรอกบัญชี</EmptyNotice>
        ) : (
          rows.map((row) => <WorkerBankCompleteForm key={row.workerId} row={row} />)
        )}
      </section>
    </PageShell>
  );
}
