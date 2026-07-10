// Spec 284 U5 / ADR 0080 — /legal/contracts/[contractId]: a contract's detail.
// requireRole(LEGAL_ROLES); the contract + its current attachments are read via
// the admin client (contracts / contract_attachments are zero-grant — spec 46
// posture). Shows the deal header, the current attachments, and the void control
// (U3's voidContract). Attachment UPLOAD is deferred with the legal document store
// (a Storage bucket + policy = its own unit); this surface lists what exists.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { LEGAL_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { safeBackHref } from "@/lib/nav/back-href";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { baht } from "@/lib/format";
import { formatThaiDate } from "@/lib/i18n/labels";
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_TYPE_LABEL,
  CONTRACT_COUNTERPARTY_LABEL,
} from "@/lib/i18n/labels";
import { ContractVoidButton } from "@/components/features/legal/contract-void-button";

export const metadata = { title: "รายละเอียดสัญญา" };

interface ContractDetailPageProps {
  params: Promise<{ contractId: string }>;
  searchParams: Promise<{ from?: string }>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-ink-secondary shrink-0 text-sm">{label}</dt>
      <dd className="text-ink min-w-0 text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

export default async function ContractDetailPage({
  params,
  searchParams,
}: ContractDetailPageProps) {
  const ctx = await requireRole(LEGAL_ROLES);
  const { contractId } = await params;
  const { from } = await searchParams;

  const admin = createAdminClient();
  const { data: contract } = await admin
    .from("contracts")
    .select(
      "id, title, counterparty_name, counterparty_type, contract_type, status, agreed_amount, currency, project_id, sign_date, effective_date, expiry_date, created_at",
    )
    .eq("id", contractId)
    .maybeSingle();

  if (!contract) notFound();

  const [{ data: attachmentRows }, { data: project }] = await Promise.all([
    admin
      .from("contract_attachments")
      .select("id, storage_path, created_at")
      .eq("contract_id", contractId)
      .is("superseded_by", null)
      .order("created_at", { ascending: false }),
    contract.project_id
      ? admin.from("projects").select("code, name").eq("id", contract.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const attachments = attachmentRows ?? [];

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Back-nav sweep 2026-07-11: reached from the contracts list AND the
          approvals queue — referrer first, contracts list as the fallback. */}
      <DetailHeader backHref={safeBackHref(from, "/legal/contracts")} backLabel="สัญญา">
        <div className="flex flex-col gap-1">
          <h1 className="text-title text-ink font-bold tracking-tight">{contract.title}</h1>
          <span className="border-edge text-ink-secondary w-fit rounded-full border px-2 py-0.5 text-xs">
            {CONTRACT_STATUS_LABEL[contract.status]}
          </span>
        </div>
      </DetailHeader>

      <section className={`mx-auto w-full ${PAGE_MAX_W} px-5 py-6`}>
        <div className={`${CARD} mb-6`}>
          <dl className="divide-edge flex flex-col divide-y">
            <Row
              label="คู่สัญญา"
              value={`${contract.counterparty_name} (${CONTRACT_COUNTERPARTY_LABEL[contract.counterparty_type]})`}
            />
            <Row label="ประเภทสัญญา" value={CONTRACT_TYPE_LABEL[contract.contract_type]} />
            {project ? <Row label="โครงการ" value={project.name ?? project.code} /> : null}
            {contract.agreed_amount != null ? (
              <Row
                label="มูลค่า"
                value={`${baht(Number(contract.agreed_amount))} ${contract.currency}`}
              />
            ) : null}
            {contract.sign_date ? (
              <Row label="วันลงนาม" value={formatThaiDate(contract.sign_date)} />
            ) : null}
            {contract.effective_date ? (
              <Row label="วันเริ่มมีผล" value={formatThaiDate(contract.effective_date)} />
            ) : null}
            {contract.expiry_date ? (
              <Row label="วันสิ้นสุด" value={formatThaiDate(contract.expiry_date)} />
            ) : null}
          </dl>
        </div>

        <h2 className={SECTION_HEADING}>เอกสารแนบ</h2>
        {attachments.length === 0 ? (
          <p className="text-ink-muted mb-6 text-sm">ยังไม่มีเอกสารแนบ</p>
        ) : (
          <ul className={`${CARD} divide-edge mb-6 flex flex-col divide-y`}>
            {attachments.map((a) => (
              <li key={a.id} className="text-ink min-w-0 truncate py-2 text-sm">
                {a.storage_path}
              </li>
            ))}
          </ul>
        )}
        <p className="text-ink-muted mb-6 text-xs">การแนบไฟล์จะเปิดใช้พร้อมที่เก็บเอกสารกฎหมาย</p>

        {contract.status !== "void" ? (
          <>
            <h2 className={SECTION_HEADING}>จัดการสัญญา</h2>
            <ContractVoidButton contractId={contract.id} />
          </>
        ) : null}
      </section>
    </PageShell>
  );
}
