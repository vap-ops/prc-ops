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
import { claimErrorToThai } from "./claim-error";
import { validateBankChange } from "./bank-change";

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
