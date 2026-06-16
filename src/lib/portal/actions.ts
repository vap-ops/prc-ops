"use server";

// Spec 130 U3 — contractor portal server actions. The claim action relays to
// the claim_contractor_invite RPC (the only sanctioned visitor→contractor
// writer, U1) through the caller's RLS-scoped session — never the admin client
// (ADR 0051 §5: external paths are RLS-enforced).

import "server-only";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { claimErrorToThai } from "./claim-error";

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
