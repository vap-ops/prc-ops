"use server";

// Spec 284 U3 / ADR 0080 — Legal contract write actions.
//
// The create/update/void/add-attachment RPCs are SECURITY DEFINER gating the
// AUTHED session's role (legal / super_admin), so we call them on
// requireActionRole(LEGAL_ROLES).auth.supabase — NEVER the admin client, whose
// service-role null role would 42501 the gate (the contact-docs / billing lesson).
// The contracts + contract_attachments tables are zero-authenticated-grant (the
// spec 46 money/document posture); reads go via the admin client behind a
// requireRole(LEGAL_ROLES) gate on the Legal surfaces (built in U5).

import "server-only";

import { requireActionRole } from "@/lib/auth/action-gate";
import { LEGAL_ROLES } from "@/lib/auth/role-home";
import type { Database } from "@/lib/db/database.types";
import type { ContractCounterpartyType, ContractStatus, ContractType } from "@/lib/db/enums";

/** Generic "could not save the contract"; the DEFINER RPC is the real guard. */
const GENERIC = "ไม่สามารถบันทึกสัญญาได้";

export type LegalCreateResult = { ok: true; id: string } | { ok: false; error: string };
export type LegalMutationResult = { ok: true } | { ok: false; error: string };

export interface CreateContractInput {
  counterpartyType: ContractCounterpartyType;
  counterpartyName: string;
  contractType: ContractType;
  title: string;
  projectId?: string;
  agreedAmount?: number;
}

export async function createContract(input: CreateContractInput): Promise<LegalCreateResult> {
  const g = await requireActionRole(LEGAL_ROLES);
  if ("error" in g) return { ok: false, error: g.error };

  // exactOptionalPropertyTypes: omit the optional args entirely (let the SQL
  // defaults apply) rather than passing undefined.
  const args: Database["public"]["Functions"]["create_contract"]["Args"] = {
    p_counterparty_type: input.counterpartyType,
    p_counterparty_name: input.counterpartyName,
    p_contract_type: input.contractType,
    p_title: input.title,
  };
  if (input.projectId) args.p_project_id = input.projectId;
  if (input.agreedAmount != null) args.p_agreed_amount = input.agreedAmount;

  const { data, error } = await g.auth.supabase.rpc("create_contract", args);
  if (error || !data) return { ok: false, error: GENERIC };
  return { ok: true, id: data };
}

export interface UpdateContractInput {
  id: string;
  counterpartyName?: string;
  projectId?: string;
  title?: string;
  agreedAmount?: number;
  signDate?: string;
  effectiveDate?: string;
  expiryDate?: string;
  status?: ContractStatus;
  documentPath?: string;
}

export async function updateContract(input: UpdateContractInput): Promise<LegalMutationResult> {
  const g = await requireActionRole(LEGAL_ROLES);
  if ("error" in g) return { ok: false, error: g.error };

  const args: Database["public"]["Functions"]["update_contract"]["Args"] = { p_id: input.id };
  if (input.counterpartyName != null) args.p_counterparty_name = input.counterpartyName;
  if (input.projectId != null) args.p_project_id = input.projectId;
  if (input.title != null) args.p_title = input.title;
  if (input.agreedAmount != null) args.p_agreed_amount = input.agreedAmount;
  if (input.signDate != null) args.p_sign_date = input.signDate;
  if (input.effectiveDate != null) args.p_effective_date = input.effectiveDate;
  if (input.expiryDate != null) args.p_expiry_date = input.expiryDate;
  if (input.status != null) args.p_status = input.status;
  if (input.documentPath != null) args.p_document_path = input.documentPath;

  const { error } = await g.auth.supabase.rpc("update_contract", args);
  if (error) return { ok: false, error: GENERIC };
  return { ok: true };
}

export async function voidContract(id: string): Promise<LegalMutationResult> {
  const g = await requireActionRole(LEGAL_ROLES);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.auth.supabase.rpc("void_contract", { p_id: id });
  if (error) return { ok: false, error: GENERIC };
  return { ok: true };
}

export interface AddContractAttachmentInput {
  contractId: string;
  storagePath: string;
}

export async function addContractAttachment(
  input: AddContractAttachmentInput,
): Promise<LegalCreateResult> {
  const g = await requireActionRole(LEGAL_ROLES);
  if ("error" in g) return { ok: false, error: g.error };
  const { data, error } = await g.auth.supabase.rpc("add_contract_attachment", {
    p_contract_id: input.contractId,
    p_storage_path: input.storagePath,
  });
  if (error || !data) return { ok: false, error: GENERIC };
  return { ok: true, id: data };
}
