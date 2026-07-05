"use server";

// Spec 263 U2 — technician self-registration server actions. All relay to the
// U1b self-serve RPCs through the caller's RLS-scoped session — this is an
// external/visitor-reachable surface (like the portal claim flow), so the
// admin client is never used (mirrors ADR 0051 §5 / spec 130's own discipline).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { isValidPhotoExt } from "@/lib/photos/path";
import { isValidUuid } from "@/lib/validate/uuid";
import { registrationErrorToThai } from "./registration-error";
import { validateRegistrationProfile } from "./registration-profile";
import { buildTechnicianDocPath } from "./technician-path";
import { isTechnicianDocPurpose } from "./document-types";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type StartResult = { ok: true; employeeId: string } | { ok: false; error: string };

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const REGISTER_PATH = "/register/technician";

// Spec 263 U1b/U2 — mint a permanent employee ID + insert a `pending` staging
// row. Gift-first (ADR 0061): the ID is minted before any approval.
export async function startTechnicianRegistration(input: {
  fullName: string;
  phone: string;
}): Promise<StartResult> {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  if (!fullName) return { ok: false, error: "กรุณาระบุชื่อ-นามสกุล" };
  if (!phone) return { ok: false, error: "กรุณาระบุเบอร์โทร" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("start_staff_registration", {
    p_full_name: fullName,
    p_phone: phone,
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };
  if (!data) return { ok: false, error: GENERIC };

  revalidatePath(REGISTER_PATH);
  return { ok: true, employeeId: data };
}

// Spec 263 U1b/U2 — progressive self-edit of the applicant's own pending row.
export async function updateOwnTechnicianRegistration(input: {
  fullName: string;
  phone: string;
  dob: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
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

  const { error } = await auth.supabase.rpc("update_own_staff_registration", {
    ...(fullName ? { p_full_name: fullName } : {}),
    ...(phone ? { p_phone: phone } : {}),
    ...(dob ? { p_date_of_birth: dob } : {}),
    ...(emergencyName ? { p_emergency_contact_name: emergencyName } : {}),
    ...(emergencyRelation ? { p_emergency_contact_relation: emergencyRelation } : {}),
    ...(emergencyPhone ? { p_emergency_contact_phone: emergencyPhone } : {}),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(REGISTER_PATH);
  return { ok: true };
}

// Spec 263 U1b/U2 — record an uploaded doc (id_card / consent / profile_photo)
// after the file lands in contact-docs at technician/<uid>/<purpose>/…. The uid
// is read SERVER-SIDE from the RLS session (never trusted from the client) and
// the storage path is REBUILT from it, mirroring addOwnContactDocument's
// discipline (spec 131 U2c) — a forged path/purpose can't reach another
// applicant's folder (the storage WITH CHECK rejects it anyway).
export async function addTechnicianRegistrationDoc(input: {
  purpose: string;
  attachmentId: string;
  ext: string;
}): Promise<ActionResult> {
  if (!isTechnicianDocPurpose(input.purpose)) return { ok: false, error: GENERIC };
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
