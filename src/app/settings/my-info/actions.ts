"use server";

// Spec 317 U2 — server actions behind the /settings/my-info surface. Each one
// relays to its DEFINER RPC on the caller's RLS session (never the admin
// client); the RPCs re-gate everything (own-row, approved-status, checksum,
// photo existence), so these are shape-validation + Thai-error relays.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { isValidPhotoExt } from "@/lib/photos/path";
import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import { validateBankChange } from "@/lib/portal/bank-change";

export type ActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const MY_INFO_PATH = "/settings/my-info";

// Spec 317 U3 — propose a legal-name / national-ID / DOB change (approved tier;
// the staff-approval trio decides; one approve applies to every linked record).
export async function submitIdentityChange(input: {
  fullName: string;
  nationalId: string;
  dob: string;
}): Promise<ActionResult> {
  const fullName = input.fullName.trim();
  const nationalId = input.nationalId.replace(/[\s-]/g, "");
  const dob = input.dob.trim();
  if (!fullName && !nationalId && !dob) {
    return { ok: false, error: "กรุณากรอกอย่างน้อยหนึ่งรายการ" };
  }
  if (fullName.length > 120) return { ok: false, error: "ชื่อยาวเกินไป" };
  if (nationalId && !/^\d{13}$/.test(nationalId)) {
    return { ok: false, error: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" };
  }
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return { ok: false, error: "วันเกิดไม่ถูกต้อง" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("submit_identity_change", {
    ...(fullName ? { p_full_name: fullName } : {}),
    ...(nationalId ? { p_national_id: nationalId } : {}),
    ...(dob ? { p_dob: dob } : {}),
  });
  if (error) {
    if (error.message.includes("already exists")) {
      return { ok: false, error: "มีคำขอที่รออนุมัติอยู่แล้ว" };
    }
    if (error.message.includes("invalid national id")) {
      return { ok: false, error: "เลขบัตรประชาชนไม่ถูกต้อง" };
    }
    return { ok: false, error: GENERIC };
  }
  revalidatePath(MY_INFO_PATH);
  return { ok: true };
}

// Spec 317 U1 — an approved office staffer edits their own CONTACT fields
// (instant tier). The RPC is coalesce-keep: blank = keep, never clears.
export async function updateOwnStaffContact(input: {
  phone: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
}): Promise<ActionResult> {
  if (input.phone.trim().length > 50 || input.emergencyPhone.trim().length > 50) {
    return { ok: false, error: "เบอร์โทรยาวเกินไป" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("update_own_staff_contact", {
    p_phone: input.phone.trim(),
    p_emergency_contact_name: input.emergencyName.trim(),
    p_emergency_contact_relation: input.emergencyRelation.trim(),
    p_emergency_contact_phone: input.emergencyPhone.trim(),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(MY_INFO_PATH);
  return { ok: true };
}

// Spec 317 U4 — an approved office staffer stages a bank change (approved tier;
// passbook photo REQUIRED — uploaded client-side to the own
// technician/<uid>/book_bank/ folder, path REBUILT here from the session uid).
export async function submitStaffBankChange(input: {
  bankName: string;
  accountNo: string;
  accountName: string;
  attachmentId: string;
  ext: string;
}): Promise<ActionResult> {
  const validation = validateBankChange(input);
  if (validation) return { ok: false, error: validation };
  if (!UUID_REGEX.test(input.attachmentId) || !isValidPhotoExt(input.ext)) {
    return { ok: false, error: GENERIC };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const path = buildTechnicianDocPath(auth.user.id, "book_bank", input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC };

  const { error } = await auth.supabase.rpc("submit_staff_bank_change", {
    p_bank_name: input.bankName.trim(),
    p_bank_account_number: input.accountNo.trim(),
    p_bank_account_name: input.accountName.trim(),
    p_book_bank_path: path,
  });
  if (error) {
    if (error.message.includes("already exists") || error.message.includes("duplicate key")) {
      return { ok: false, error: "มีคำขอที่รออนุมัติอยู่แล้ว" };
    }
    if (error.message.includes("bound workers")) {
      return { ok: false, error: "บัญชีช่างแก้ไขได้ที่หน้าหลักช่าง" };
    }
    if (error.message.includes("invalid account number")) {
      return { ok: false, error: "เลขที่บัญชีไม่ถูกต้อง (ตัวเลข 6-20 หลัก)" };
    }
    return { ok: false, error: GENERIC };
  }
  revalidatePath(MY_INFO_PATH);
  return { ok: true };
}

// Spec 319 U2 — a login-keyed (admin/office) staffer with no worker/contractor/
// approved-registration bank home stages a bank change (approved tier; the
// staff-approval trio decides; approve upserts user_bank). Passbook photo
// REQUIRED — uploaded client-side to the own technician/<uid>/book_bank/ folder,
// path REBUILT here from the session uid.
export async function submitUserBankChange(input: {
  bankName: string;
  accountNo: string;
  accountName: string;
  attachmentId: string;
  ext: string;
}): Promise<ActionResult> {
  const validation = validateBankChange(input);
  if (validation) return { ok: false, error: validation };
  if (!UUID_REGEX.test(input.attachmentId) || !isValidPhotoExt(input.ext)) {
    return { ok: false, error: GENERIC };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const path = buildTechnicianDocPath(auth.user.id, "book_bank", input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC };

  const { error } = await auth.supabase.rpc("submit_user_bank_change", {
    p_bank_name: input.bankName.trim(),
    p_bank_account_number: input.accountNo.trim(),
    p_bank_account_name: input.accountName.trim(),
    p_book_bank_path: path,
  });
  if (error) {
    if (error.message.includes("already exists") || error.message.includes("duplicate key")) {
      return { ok: false, error: "มีคำขอที่รออนุมัติอยู่แล้ว" };
    }
    if (error.message.includes("bound workers")) {
      return { ok: false, error: "บัญชีช่างแก้ไขได้ที่หน้าหลักช่าง" };
    }
    if (error.message.includes("contractors use")) {
      return { ok: false, error: "บัญชีผู้รับเหมาแก้ไขได้ที่พอร์ทัลผู้รับเหมา" };
    }
    if (error.message.includes("approved staff")) {
      return { ok: false, error: "บัญชีของคุณแก้ไขได้ที่ส่วนบัญชีธนาคารของพนักงาน" };
    }
    if (error.message.includes("invalid account number")) {
      return { ok: false, error: "เลขที่บัญชีไม่ถูกต้อง (ตัวเลข 6-20 หลัก)" };
    }
    return { ok: false, error: GENERIC };
  }
  revalidatePath(MY_INFO_PATH);
  return { ok: true };
}

// Spec 321 U8a — the login-keyed bank goes INSTANT (operator 2026-07-15): record
// the caller's own user_bank directly via record_own_user_bank instead of staging
// a request for the trio. Same passbook rebuild + single-home guards as the submit
// path; no pending/queue error to map.
export async function recordUserBank(input: {
  bankName: string;
  accountNo: string;
  accountName: string;
  attachmentId: string;
  ext: string;
}): Promise<ActionResult> {
  const validation = validateBankChange(input);
  if (validation) return { ok: false, error: validation };
  if (!UUID_REGEX.test(input.attachmentId) || !isValidPhotoExt(input.ext)) {
    return { ok: false, error: GENERIC };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const path = buildTechnicianDocPath(auth.user.id, "book_bank", input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC };

  const { error } = await auth.supabase.rpc("record_own_user_bank", {
    p_bank_name: input.bankName.trim(),
    p_bank_account_number: input.accountNo.trim(),
    p_bank_account_name: input.accountName.trim(),
    p_book_bank_path: path,
  });
  if (error) {
    if (error.message.includes("bound workers")) {
      return { ok: false, error: "บัญชีช่างแก้ไขได้ที่หน้าหลักช่าง" };
    }
    if (error.message.includes("contractors use")) {
      return { ok: false, error: "บัญชีผู้รับเหมาแก้ไขได้ที่พอร์ทัลผู้รับเหมา" };
    }
    if (error.message.includes("approved staff")) {
      return { ok: false, error: "บัญชีของคุณแก้ไขได้ที่ส่วนบัญชีธนาคารของพนักงาน" };
    }
    if (error.message.includes("invalid account number")) {
      return { ok: false, error: "เลขที่บัญชีไม่ถูกต้อง (ตัวเลข 6-20 หลัก)" };
    }
    return { ok: false, error: GENERIC };
  }
  revalidatePath(MY_INFO_PATH);
  return { ok: true };
}
