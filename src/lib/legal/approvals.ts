"use server";

// Spec 284 U4 / ADR 0080 — Legal document-decision write action.
//
// submit_document_decision is a SECURITY DEFINER RPC gating the AUTHED session's
// role (legal / super_admin via DOC_APPROVAL_ROLES), so we call it on
// requireActionRole(DOC_APPROVAL_ROLES).auth.supabase — NEVER the admin client,
// whose service-role null role would 42501 the gate (the contact-docs / contracts
// lesson). document_approvals is zero-authenticated-grant (the spec 46 money/
// document posture); reads go via the admin client behind a requireRole gate on the
// Legal surfaces (built in U5). An 'approve' decision transitions the contract
// draft→active inside the RPC (single txn) — the action just relays the decision.

import "server-only";

import { requireActionRole } from "@/lib/auth/action-gate";
import { DOC_APPROVAL_ROLES } from "@/lib/auth/role-home";
import type { DocumentDecision } from "@/lib/db/enums";

/** Generic "could not record the decision"; the DEFINER RPC is the real guard. */
const GENERIC = "ไม่สามารถบันทึกผลการพิจารณาได้";

export type LegalCreateResult = { ok: true; id: string } | { ok: false; error: string };

export interface SubmitDocumentDecisionInput {
  contractId: string;
  decision: DocumentDecision;
  comment: string;
}

export async function submitDocumentDecision(
  input: SubmitDocumentDecisionInput,
): Promise<LegalCreateResult> {
  const g = await requireActionRole(DOC_APPROVAL_ROLES);
  if ("error" in g) return { ok: false, error: g.error };

  const { data, error } = await g.auth.supabase.rpc("submit_document_decision", {
    p_contract_id: input.contractId,
    p_decision: input.decision,
    p_comment: input.comment,
  });
  if (error || !data) return { ok: false, error: GENERIC };
  return { ok: true, id: data };
}
