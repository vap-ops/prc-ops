"use server";

// Spec 130 U3 — contractor portal server actions. The claim action relays to
// the claim_contractor_invite RPC (the only sanctioned visitor→contractor
// writer, U1) through the caller's RLS-scoped session — never the admin client
// (ADR 0051 §5: external paths are RLS-enforced).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { isValidPhotoExt } from "@/lib/photos/path";
import { buildContactDocPath } from "@/lib/contacts/document-path";
import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import { claimErrorToThai } from "./claim-error";
import { validateBankChange } from "./bank-change";
import { validateEmergencyContact } from "./emergency-contact";
import { validateContractorProfile } from "./contractor-profile";
import { validateWorkerProfile } from "./worker-profile";
import { isPortalDocPurpose } from "./document-types";

export type ClaimResult = { ok: true } | { ok: false; error: string };

export async function claimContractorInvite(input: { token: string }): Promise<ClaimResult> {
  const token = input.token?.trim();
  if (!token) return { ok: false, error: "ลิงก์ไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // Spec 170 U4a — a ช่าง binds on workers.user_id, so try the worker invite
  // first; a worker token binds the worker + flips the role. An INVALID-token
  // failure means this is a contractor-party token → fall through to the
  // contractor claim. Any other worker-claim failure (expired / used /
  // already-bound / not-a-visitor) is the real error and is surfaced.
  const worker = await auth.supabase.rpc("claim_worker_invite", { p_token: token });
  if (!worker.error) return { ok: true };
  if (!worker.error.message.includes("invalid token")) {
    return { ok: false, error: claimErrorToThai(worker.error.message) };
  }

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

// Spec 170 U4c-2 — a bound ช่าง submits a bank change (→ pending → PM
// approval). The worker analogue of submitBankChange; submit_worker_bank_change
// enforces bound-worker-only / own / one-pending. Reuses validateBankChange (the
// shape/UX rules are identical). RLS-scoped session.
//
// Spec 315 U2 — the request now carries a REQUIRED passbook photo. The client
// uploads to storage first and passes {attachmentId, ext}; the path is REBUILT
// server-side from the session uid (never trusted from the client — the
// addStaffRegistrationDoc discipline), and the RPC re-checks owner/purpose.
export async function submitWorkerBankChange(input: {
  bankName: string;
  accountNo: string;
  accountName: string;
  attachmentId: string;
  ext: string;
  revalidate: string;
}): Promise<ActionResult> {
  if (!input.revalidate.startsWith("/")) return { ok: false, error: GENERIC_BANK };
  const validation = validateBankChange(input);
  if (validation) return { ok: false, error: validation };
  if (!UUID_REGEX.test(input.attachmentId) || !isValidPhotoExt(input.ext)) {
    return { ok: false, error: GENERIC_BANK };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const path = buildTechnicianDocPath(auth.user.id, "book_bank", input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC_BANK };

  const { error } = await auth.supabase.rpc("submit_worker_bank_change", {
    p_bank_name: input.bankName.trim(),
    p_bank_account_number: input.accountNo.trim(),
    p_bank_account_name: input.accountName.trim(),
    p_book_bank_path: path,
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
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is gated here too.
  const effectiveRole = await applyAssumedRole(me?.role);
  if (!effectiveRole || !PM_ROLES.includes(effectiveRole)) {
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

// Spec 170 U4c-2 — PM approve/reject a pending WORKER bank change. On approve the
// RPC applies it to the worker's own bank_* columns. pm/super/director (relay +
// RPC gate). The worker analogue of decideBankChange.
export async function decideWorkerBankChange(input: {
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
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is gated here too.
  const effectiveRole = await applyAssumedRole(me?.role);
  // DC edit matrix (2026-07-13): procurement_manager joins the WORKER bank-change
  // deciders — it owns ช่าง onboarding (spec 261 / ADR 0070; completes the
  // capture-blind bank transcribe, spec 298 U3), mirroring the widened
  // decide_worker_bank_change RPC gate. Plain procurement stays OUT (buyer, not an
  // approver of worker money). The CONTRACTOR path (decideBankChange) is unchanged.
  if (!effectiveRole || ![...PM_ROLES, "procurement_manager"].includes(effectiveRole)) {
    return { ok: false, error: "คุณไม่มีสิทธิ์อนุมัติการเปลี่ยนบัญชี" };
  }

  const { error } = await auth.supabase.rpc("decide_worker_bank_change", {
    p_id: input.id,
    p_approve: input.approve,
  });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath(input.revalidate);
  return { ok: true };
}

// Spec 131 U2b — a ช่าง self-edits their own emergency contact + DOB from the
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

// Spec 132 U1 — a ช่าง self-edits their own contactability (phone/email/contact
// person/mailing address) from the portal. The RPC is column-scoped to these four
// fields for the caller's own contractor (no broad UPDATE policy — so name/status/
// tax_id stay out of reach). Contactability is not money — direct, no staging.
export async function updateOwnContactInfo(input: {
  phone: string;
  email: string;
  contactPerson: string;
  mailingAddress: string;
}): Promise<ActionResult> {
  const validation = validateContractorProfile(input);
  if (validation) return { ok: false, error: validation };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("update_own_contractor_profile", {
    p_phone: input.phone.trim(),
    p_email: input.email.trim(),
    p_contact_person: input.contactPerson.trim(),
    p_mailing_address: input.mailingAddress.trim(),
  });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath("/portal");
  return { ok: true };
}

// Spec 170 U4b / ADR 0062 — a bound ช่าง self-edits their own portal profile
// (contact + emergency + DOB) in one call. update_own_worker_profile is
// column-scoped to those six fields for current_user_worker_id() (name/day_rate/
// tax_id stay out of reach). Not money → applies directly, no staging.
export async function updateOwnWorkerProfile(input: {
  phone: string;
  email: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
  dob: string;
}): Promise<ActionResult> {
  const validation = validateWorkerProfile(input);
  if (validation) return { ok: false, error: validation };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("update_own_worker_profile", {
    p_phone: input.phone.trim(),
    p_email: input.email.trim(),
    p_emergency_name: input.emergencyName.trim(),
    p_emergency_relation: input.emergencyRelation.trim(),
    p_emergency_phone: input.emergencyPhone.trim(),
    ...(input.dob ? { p_dob: input.dob } : {}),
  });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath("/portal");
  return { ok: true };
}

// Spec 170 U4b-2 / ADR 0062 — a bound ช่าง records their own PDPA /
// background-check consent from the portal. record_worker_consent self-validates
// (current_user_worker_id); a forged kind is rejected here, an unbound caller by
// the RPC. Withdrawal reuses revokeOwnConsent (revoke_contractor_consent now
// admits the bound worker).
export async function recordOwnWorkerConsent(input: { kind: string }): Promise<ActionResult> {
  if (input.kind !== "pdpa_data" && input.kind !== "background_check") {
    return { ok: false, error: GENERIC_BANK };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("record_worker_consent", { p_kind: input.kind });
  if (error) return { ok: false, error: GENERIC_BANK };
  revalidatePath("/portal");
  return { ok: true };
}

// Spec 131 U2b — a ช่าง records their own PDPA / background-check consent from the
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

// Spec 131 U3 — a bound ช่าง withdraws their OWN consent (PDPA right to withdraw).
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

// Spec 131 U2c — a bound ช่าง records their OWN contact document after uploading
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
