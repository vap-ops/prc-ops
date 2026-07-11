"use server";

// Spec 298 U3 — a money-authorized approver transcribes the SA-captured passbook into
// workers.bank_* via the complete_worker_bank DEFINER RPC (which re-gates
// STAFF_APPROVAL_ROLES, validates + normalizes the account number, flips the capture to
// on_file, and NEVER touches pay/level — ADR 0079). The page already passed
// requireRole(STAFF_APPROVAL_ROLES); the RPC is the authoritative gate. This action
// does a light non-empty pre-check and maps the RPC's errors to Thai.

import "server-only";
import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";

export type CompleteWorkerBankResult = { ok: true } | { ok: false; error: string };

function errorToThai(message: string): string {
  if (message.includes("no pending bank capture"))
    return "ไม่พบรายการรอกรอกบัญชีของช่างคนนี้ (อาจถูกกรอกไปแล้ว)";
  if (message.includes("account number must be")) return "เลขบัญชีต้องเป็นตัวเลข 6-20 หลัก";
  if (message.includes("are required")) return "กรุณากรอกธนาคาร เลขบัญชี และชื่อบัญชีให้ครบ";
  if (message.includes("not permitted")) return "ไม่มีสิทธิ์กรอกบัญชีให้ช่าง";
  return "บันทึกบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

export async function completeWorkerBank(input: {
  workerId: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<CompleteWorkerBankResult> {
  const bankName = input.bankName.trim();
  const accountName = input.accountName.trim();
  if (!bankName || !accountName || !input.accountNumber.trim())
    return { ok: false, error: "กรุณากรอกธนาคาร เลขบัญชี และชื่อบัญชีให้ครบ" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("complete_worker_bank", {
    p_worker_id: input.workerId,
    p_bank_name: bankName,
    p_account_number: input.accountNumber, // the RPC strips spaces/dashes + validates
    p_account_name: accountName,
  });
  if (error) return { ok: false, error: errorToThai(error.message) };

  revalidatePath("/registrations/awaiting-bank");
  return { ok: true };
}
