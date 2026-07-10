// Spec 284 U5 / ADR 0080 — /legal/approvals: the document-approval queue. A queue
// mirroring /registrations — every contract still in 'draft' (awaiting a legal
// decision) with a decision form (approve / reject / needs_revision + required
// comment → U4's submit_document_decision). An 'approve' flips the contract
// draft→active, so it leaves the queue. requireRole(LEGAL_ROLES); rows read via the
// admin client (contracts is zero-grant — spec 46 posture). (reject / needs_revision
// record a decision in the append-only ledger but leave the contract in draft.)

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { LEGAL_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { baht } from "@/lib/format";
import {
  LEGAL_APPROVALS_LABEL,
  CONTRACT_TYPE_LABEL,
  CONTRACT_COUNTERPARTY_LABEL,
} from "@/lib/i18n/labels";
import { DocumentDecisionForm } from "@/components/features/legal/document-decision-form";
import { withBackFrom } from "@/lib/nav/back-href";

export const metadata = { title: "เอกสารรออนุมัติ" };

export default async function LegalApprovalsPage() {
  const ctx = await requireRole(LEGAL_ROLES);

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("contracts")
    .select("id, title, counterparty_name, counterparty_type, contract_type, agreed_amount")
    .eq("status", "draft")
    .order("created_at", { ascending: true });

  const drafts = rows ?? [];

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/legal" backLabel="ฝ่ายกฎหมาย">
        <h1 className="text-title text-ink font-bold tracking-tight">{LEGAL_APPROVALS_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto w-full ${PAGE_MAX_W} px-5 py-6`}>
        {drafts.length === 0 ? (
          <EmptyNotice>ไม่มีสัญญารอการพิจารณา</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-4">
            {drafts.map((c) => (
              <li key={c.id} className={`${CARD} flex flex-col gap-3`}>
                <Link
                  href={withBackFrom(`/legal/contracts/${c.id}`, "/legal/approvals")}
                  className="hover:bg-sunk focus-visible:ring-action -mx-2 flex items-center gap-3 rounded-md px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-ink text-body block font-semibold">{c.title}</span>
                    <span className="text-ink-secondary text-meta block">
                      {c.counterparty_name} · {CONTRACT_COUNTERPARTY_LABEL[c.counterparty_type]} ·{" "}
                      {CONTRACT_TYPE_LABEL[c.contract_type]}
                      {c.agreed_amount != null ? ` · ${baht(Number(c.agreed_amount))}` : ""}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
                </Link>
                <DocumentDecisionForm contractId={c.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
