"use server";

// Spec 130 U3 — contractor portal server actions. The claim action relays to
// the claim_contractor_invite RPC (the only sanctioned visitor→contractor
// writer, U1) through the caller's RLS-scoped session — never the admin client
// (ADR 0051 §5: external paths are RLS-enforced).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { isValidPhotoExt } from "@/lib/photos/path";
import { buildContactDocPath } from "@/lib/contacts/document-path";
import { claimErrorToThai } from "./claim-error";
import { validateBankChange } from "./bank-change";
import { validateEmergencyContact } from "./emergency-contact";
import { isPortalDocPurpose } from "./document-types";

export type ClaimResult = { ok: true } | { ok: false; error: string };

export async function claimContractorInvite(input: { token: string }): Promise<ClaimResult> {
  const token = input.token?.trim();
  if (!token) return { ok: false, error: "ลิงก์ไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("claim_contractor_invite", { p_token: token });
  if (error) return { ok: false, error: claimErrorToThai(error.message) };
  return { ok: true };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_BANK = "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

// Spec 130 U4 — a bound contractor submits a bank change (→ pending → PM
// approval). RLS-scoped session; the RPC enforces contractor-only/own/one-
// pending.
export async function submitBankChange(input: {
  bankName: string;
  accountNo: string;
  accountName: string;
  revalidate: string;
}): Promise<ActionResult> {
  if (!input.revalidate.startsWith("/")) return { ok: false, error: GENERIC_BANK };
  const validation = validateBankChange(input);
  if (validation) return { ok: false, error: validation };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("submit_contractor_bank_change", {
    p_bank_name: input.bankName.trim(),
    p_bank_account_no: input.accountNo.trim(),
    p_bank_account_name: input.accountName.trim(),
  });
  if (error) {
    if (error.message.includes("already exists")) {
      return { ok: false, error: "มีคำขอที่รออนุมัติอยู่แล้ว" };
    }
    return { ok: false, error: GENERIC_BANK };
  }
  revalidatePath(input.revalidate);
  return { ok: true };
}

// Spec 130 U4 — PM approve/reject a pending bank change. On approve the RPC
// applies it to the live contact_bank. pm/super only (relay + RPC gate).
export async function decideBankChange(input: {
  id: string;
  approve: boolean;
  revalidate: string;
}): Promise<ActionResult> {
  if (!UUID_REGEX.test(input.id) || !input.revalidate.startsWith("/")) {
    return { ok: false, error: GENERIC_BANK };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data: me } = await auth.supabase
    .from("users")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!me || !PM_ROLES.includes(me.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่อนุมัติได้" };
  }

  const { error } = await auth.supabase.rpc("decide_contractor_bank_change", {
    p_id: input.id,
    p_approve: input.approve,
  });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath(input.revalidate);
  return { ok: true };
}

// Spec 131 U2b — DC self-edits their own emergency contact + DOB from the
// portal. The RPC is column-scoped to the four fields for the caller's own
// contractor (no broad UPDATE policy). Emergency contact is not money — direct,
// no staging.
export async function updateOwnEmergencyContact(input: {
  name: string;
  relation: string;
  phone: string;
  dob: string;
}): Promise<ActionResult> {
  const validation = validateEmergencyContact(input);
  if (validation) return { ok: false, error: validation };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("update_own_emergency_contact", {
    p_name: input.name.trim(),
    p_relation: input.relation.trim(),
    p_phone: input.phone.trim(),
    ...(input.dob ? { p_dob: input.dob } : {}),
  });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath("/portal");
  return { ok: true };
}

// Spec 131 U2b — DC records their own PDPA / background-check consent from the
// portal. record_contractor_consent self-validates (current_user_contractor_id
// = p_contractor), so passing the portal-read contractor id is safe — a forged
// id fails the RPC's own-or-staff gate.
export async function recordOwnConsent(input: {
  contractorId: string;
  kind: string;
}): Promise<ActionResult> {
  if (!UUID_REGEX.test(input.contractorId)) return { ok: false, error: GENERIC_BANK };
  if (input.kind !== "pdpa_data" && input.kind !== "background_check") {
    return { ok: false, error: GENERIC_BANK };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("record_contractor_consent", {
    p_contractor: input.contractorId,
    p_kind: input.kind,
  });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath("/portal");
  return { ok: true };
}

// Spec 131 U3 — a bound DC withdraws their OWN consent (PDPA right to withdraw).
// revoke_contractor_consent self-validates (own contractor OR pm/super), so a
// forged consent id 42501s; it only sets revoked_at (no deletion, append-only
// spirit). Withdrawing reopens the completeness checklist's consent item.
export async function revokeOwnConsent(input: { id: string }): Promise<ActionResult> {
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_BANK };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("revoke_contractor_consent", { p_id: input.id });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath("/portal");
  return { ok: true };
}

// Spec 131 U2c — a bound DC records their OWN contact document after uploading
// the file to the private contact-docs bucket (browser client, own path). The
// contractor id is read SERVER-SIDE from the RLS session (never trusted from the
// client) and the storage path is REBUILT from it — so a forged path/id can't
// reach another contractor's folder (the add_contact_document RPC re-validates
// own-contractor, and the storage WITH CHECK rejects a foreign path anyway).
const GENERIC_DOC = "บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function addOwnContactDocument(input: {
  purpose: string;
  attachmentId: string;
  ext: string;
}): Promise<ActionResult> {
  if (!isPortalDocPurpose(input.purpose)) return { ok: false, error: GENERIC_DOC };
  if (!UUID_REGEX.test(input.attachmentId)) return { ok: false, error: GENERIC_DOC };
  if (!isValidPhotoExt(input.ext)) return { ok: false, error: GENERIC_DOC };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // The bound contractor of the caller — resolved by the RLS session, not input.
  const { data: contractorId } = await auth.supabase.rpc("current_user_contractor_id");
  if (!contractorId) return { ok: false, error: GENERIC_DOC };

  const path = buildContactDocPath("contractor", contractorId, input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC_DOC };

  const { error } = await auth.supabase.rpc("add_contact_document", {
    p_contractor_id: contractorId,
    p_purpose: input.purpose,
    p_storage_path: path,
  });
  if (error) return { ok: false, error: GENERIC_DOC };
  revalidatePath("/portal");
  return { ok: true };
}
