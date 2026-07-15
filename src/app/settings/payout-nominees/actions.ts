"use server";

// Spec 320 U2 — server actions behind the PM /settings/payout-nominees surface.
// Each relays to its procurement_manager-gated DEFINER RPC on the caller's RLS
// session (never the admin client); the RPCs re-gate everything (PM role, worker
// existence, consent folder-pin + existence), so these are shape-validation +
// Thai-error relays. The consent path is REBUILT here from workerId — a
// client-supplied path is never trusted.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { isValidPhotoExt } from "@/lib/photos/path";
import { buildNomineeConsentPath } from "@/lib/payroll/payout-nominee-path";

export type ActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NOT_PERMITTED = "เฉพาะผู้จัดการฝ่ายจัดซื้อเท่านั้นที่จัดการบัญชีตัวแทนได้";
const NOMINEES_PATH = "/settings/payout-nominees";

export async function setPayoutNominee(input: {
  workerId: string;
  payeeName: string;
  relationship: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  attachmentId: string;
  ext: string;
}): Promise<ActionResult> {
  if (!UUID_REGEX.test(input.workerId)) return { ok: false, error: GENERIC };
  if (
    !input.payeeName.trim() ||
    !input.relationship.trim() ||
    !input.bankName.trim() ||
    !input.accountNo.trim() ||
    !input.accountName.trim()
  ) {
    return { ok: false, error: "กรุณากรอกข้อมูลผู้รับเงินให้ครบ" };
  }
  if (!UUID_REGEX.test(input.attachmentId) || !isValidPhotoExt(input.ext)) {
    return { ok: false, error: GENERIC };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const path = buildNomineeConsentPath(input.workerId, input.attachmentId, input.ext);
  if (!path) return { ok: false, error: GENERIC };

  const { error } = await auth.supabase.rpc("set_worker_payout_nominee", {
    p_worker_id: input.workerId,
    p_payee_name: input.payeeName.trim(),
    p_payee_relationship: input.relationship.trim(),
    p_payee_bank_name: input.bankName.trim(),
    p_payee_account_number: input.accountNo.trim(),
    p_payee_account_name: input.accountName.trim(),
    p_consent_doc_path: path,
  });
  if (error) {
    if (error.message.includes("role not permitted")) return { ok: false, error: NOT_PERMITTED };
    if (error.message.includes("worker not found")) {
      return { ok: false, error: "ไม่พบช่างคนนี้" };
    }
    if (error.message.includes("invalid account number")) {
      return { ok: false, error: "เลขที่บัญชีไม่ถูกต้อง (ตัวเลข 6-20 หลัก)" };
    }
    if (error.message.includes("consent")) {
      return { ok: false, error: "แนบรูปหนังสือยินยอมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    return { ok: false, error: GENERIC };
  }
  revalidatePath(NOMINEES_PATH);
  return { ok: true };
}

export async function clearPayoutNominee(workerId: string): Promise<ActionResult> {
  if (!UUID_REGEX.test(workerId)) return { ok: false, error: GENERIC };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("clear_worker_payout_nominee", {
    p_worker_id: workerId,
  });
  if (error) {
    if (error.message.includes("role not permitted")) return { ok: false, error: NOT_PERMITTED };
    return { ok: false, error: GENERIC };
  }
  revalidatePath(NOMINEES_PATH);
  return { ok: true };
}
