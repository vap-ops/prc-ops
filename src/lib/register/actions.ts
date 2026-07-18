"use server";

// Spec 263 U2 / spec 264 G1+G2 — staff self-registration server actions. All
// relay to the self-serve RPCs through the caller's RLS-scoped session — this
// is an external/visitor-reachable surface (like the portal claim flow), so the
// admin client is never used (mirrors ADR 0051 §5 / spec 130's own discipline).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { isValidPhotoExt } from "@/lib/photos/path";
import { isValidUuid } from "@/lib/validate/uuid";
import { registrationErrorToThai } from "./registration-error";
import { validateRegistrationProfile } from "./registration-profile";
import { validateRegistrationBank, normalizeAccountNumber } from "./registration-bank";
import { buildTechnicianDocPath } from "./technician-path";
import { isStaffDocPurpose } from "./document-types";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type StartResult = { ok: true; employeeId: string } | { ok: false; error: string };

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const REGISTER_PATH = "/register/technician";

// Spec 263 U1b/U2, renamed spec 264 G1/G2 — mint a permanent employee ID +
// insert a `pending` staging row. Gift-first (ADR 0061): the ID is minted
// before any approval. declaredRoleHint is optional/advisory (never a gate,
// never written to users.role — ADR 0072 §3).
export async function startStaffRegistration(input: {
  fullName: string;
  phone: string;
  declaredRoleHint?: string;
  // Spec 279 F2b — carried by the SA's per-project QR (?by / ?project). Read off
  // a URL, so attacker-controllable: gate on UUID SHAPE here and DROP anything
  // malformed (the RPC args are typed `uuid` — a non-uuid would 22P02 and block a
  // legitimate applicant). A well-formed-but-forged uuid still reaches the RPC,
  // which existence-coerces it to NULL. Never an authz signal (advisory only).
  invitedBy?: string;
  invitedProjectId?: string;
  // Spec 328 — carried by the per-firm subcon QR (?contractor). Same trust model
  // as invitedProjectId: uuid-gated here, existence-coerced by the RPC, advisory.
  invitedContractorId?: string;
}): Promise<StartResult> {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const declaredRoleHint = input.declaredRoleHint?.trim() ?? "";
  if (!fullName) return { ok: false, error: "กรุณาระบุชื่อ-นามสกุล" };
  if (!phone) return { ok: false, error: "กรุณาระบุเบอร์โทร" };

  const invitedBy = input.invitedBy && isValidUuid(input.invitedBy) ? input.invitedBy : undefined;
  const invitedProjectId =
    input.invitedProjectId && isValidUuid(input.invitedProjectId)
      ? input.invitedProjectId
      : undefined;
  const invitedContractorId =
    input.invitedContractorId && isValidUuid(input.invitedContractorId)
      ? input.invitedContractorId
      : undefined;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("start_staff_registration", {
    p_full_name: fullName,
    p_phone: phone,
    ...(declaredRoleHint ? { p_declared_role_hint: declaredRoleHint } : {}),
    ...(invitedBy ? { p_invited_by: invitedBy } : {}),
    ...(invitedProjectId ? { p_invited_project_id: invitedProjectId } : {}),
    ...(invitedContractorId ? { p_invited_contractor_id: invitedContractorId } : {}),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };
  if (!data) return { ok: false, error: GENERIC };

  revalidatePath(REGISTER_PATH);
  return { ok: true, employeeId: data };
}

// Spec 263 U1b/U2, renamed spec 264 G1/G2 — self-edit of the applicant's own
// pending row. All fields optional (self-service, not forced beyond start).
export async function updateOwnStaffRegistration(input: {
  fullName: string;
  phone: string;
  dob: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
  declaredRoleHint?: string;
}): Promise<ActionResult> {
  const validation = validateRegistrationProfile({
    fullName: input.fullName,
    phone: input.phone,
    dob: input.dob,
    emergencyName: input.emergencyName,
    emergencyRelation: input.emergencyRelation,
    emergencyPhone: input.emergencyPhone,
  });
  if (validation) return { ok: false, error: validation };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const dob = input.dob.trim();
  const emergencyName = input.emergencyName.trim();
  const emergencyRelation = input.emergencyRelation.trim();
  const emergencyPhone = input.emergencyPhone.trim();
  const declaredRoleHint = input.declaredRoleHint?.trim() ?? "";

  const { error } = await auth.supabase.rpc("update_own_staff_registration", {
    ...(fullName ? { p_full_name: fullName } : {}),
    ...(phone ? { p_phone: phone } : {}),
    ...(dob ? { p_date_of_birth: dob } : {}),
    ...(emergencyName ? { p_emergency_contact_name: emergencyName } : {}),
    ...(emergencyRelation ? { p_emergency_contact_relation: emergencyRelation } : {}),
    ...(emergencyPhone ? { p_emergency_contact_phone: emergencyPhone } : {}),
    ...(declaredRoleHint ? { p_declared_role_hint: declaredRoleHint } : {}),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(REGISTER_PATH);
  return { ok: true };
}

// Spec 263 U1b/U2, renamed spec 264 G1/G2 — record an uploaded doc (id_card /
// profile_photo — `consent` retired, see recordOwnStaffConsent) after the file
// lands in contact-docs at technician/<uid>/<purpose>/…. The uid is read
// SERVER-SIDE from the RLS session (never trusted from the client) and the
// storage path is REBUILT from it, mirroring addOwnContactDocument's
// discipline (spec 131 U2c) — a forged path/purpose can't reach another
// applicant's folder (the storage WITH CHECK rejects it anyway).
export async function addStaffRegistrationDoc(input: {
  purpose: string;
  attachmentId: string;
  ext: string;
}): Promise<ActionResult> {
  if (!isStaffDocPurpose(input.purpose)) return { ok: false, error: GENERIC };
  if (!isValidUuid(input.attachmentId)) return { ok: false, error: GENERIC };
  if (!isValidPhotoExt(input.ext)) return { ok: false, error: GENERIC };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const path = buildTechnicianDocPath(auth.user.id, input.purpose, input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC };

  const { error } = await auth.supabase.rpc("add_staff_registration_doc", {
    p_purpose: input.purpose,
    p_storage_path: path,
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(REGISTER_PATH);
  return { ok: true };
}

// Spec 264 G2 — the applicant records their own PDPA consent (a checkbox, not a
// file upload). record_staff_consent is self-scoped (own pending registration)
// and defaults p_kind to the only staff_consent_kind value (pdpa_data), so no
// input is taken here — ticking the box is the entire signal.
export async function recordOwnStaffConsent(): Promise<ActionResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("record_staff_consent", {});
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(REGISTER_PATH);
  return { ok: true };
}

// Spec 296 — the applicant records their own declared bank (name / account no /
// account holder) on their pending registration. Stored in the zero-grant
// staff_registration_bank via record_own_staff_bank (own + pending guard). The
// account number is normalized to digits before the RPC (which re-validates and
// is the authoritative gate). Visitor-reachable → RLS session only, never admin.
export async function recordOwnStaffBank(input: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<ActionResult> {
  const validation = validateRegistrationBank(input);
  if (validation) return { ok: false, error: validation };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("record_own_staff_bank", {
    p_bank_name: input.bankName.trim(),
    p_account_number: normalizeAccountNumber(input.accountNumber),
    p_account_name: input.accountName.trim(),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(REGISTER_PATH);
  return { ok: true };
}
