"use server";

// Spec 162 U1 — award Nova coins. Authorization is the DB's: post_coins
// (spec 160 U2) is a SECURITY DEFINER RPC gated to super_admin. This action
// validates shape, re-checks the role (defence in depth), relays to post_coins,
// and revalidates the console. A reversal is a negative award via the same path.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { COIN_SOURCES, type CoinSource } from "@/lib/nova/coin-source";

const GENERIC_ERROR = "มอบเหรียญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type AwardCoinsResult = { ok: true } | { ok: false; error: string };

export async function awardCoins(input: {
  workerId: string;
  source: CoinSource;
  amount: number;
  reason: string;
}): Promise<AwardCoinsResult> {
  if (!UUID_REGEX.test(input.workerId)) return { ok: false, error: GENERIC_ERROR };
  if (!COIN_SOURCES.includes(input.source)) return { ok: false, error: GENERIC_ERROR };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "จำนวนเหรียญต้องมากกว่า 0" };
  }
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 500) {
    return { ok: false, error: "กรุณาระบุเหตุผล" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is blocked here too.
  const role = await applyAssumedRole(me?.role);
  if (role !== "super_admin") return { ok: false, error: GENERIC_ERROR };

  const { error } = await supabase.rpc("post_coins", {
    p_worker: input.workerId,
    p_source: input.source,
    p_amount: input.amount,
    p_reason: reason,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/nova");
  return { ok: true };
}
