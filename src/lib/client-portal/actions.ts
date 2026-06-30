"use server";

// Spec 233 / ADR 0067 U5 — the client portal claim action. Relays to the
// claim_client_invite RPC (the ONLY sanctioned visitor→client writer, U2)
// through the caller's RLS-scoped session — never the admin client. The RPC
// rejects any non-visitor caller (no silent role flip); its raise messages map
// to Thai via the shared claimErrorToThai (the substrings overlap the
// contractor invite's, so it is reused rather than re-rolled).

import "server-only";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { claimErrorToThai } from "@/lib/portal/claim-error";

export type ClientClaimResult = { ok: true } | { ok: false; error: string };

export async function claimClientInvite(input: { token: string }): Promise<ClientClaimResult> {
  const token = input.token?.trim();
  if (!token) return { ok: false, error: "ลิงก์ไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("claim_client_invite", { p_token: token });
  if (error) return { ok: false, error: claimErrorToThai(error.message) };
  return { ok: true };
}
