"use server";

// Spec 161 U12 — per-worker Nova operator actions: award the saver's bonus,
// confiscate (narrow reasons), redeem a shop item for a worker. All are
// SECURITY DEFINER super_admin-only RPCs (award_savers_bonus / confiscate_coins /
// redeem_shop_item), relayed via the RLS server client (the caller's JWT — the
// gate reads current_user_role(), which the service-role admin client lacks).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { CONFISCATION_REASONS, type ConfiscationReason } from "@/lib/nova/confiscation";

const GENERIC_ERROR = "ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type WorkerActionResult = { ok: true } | { ok: false; error: string };

type ActionClient = NonNullable<Awaited<ReturnType<typeof getActionUser>>>["supabase"];

async function requireSuper(): Promise<{ supabase: ActionClient } | { error: string }> {
  const auth = await getActionUser();
  if (!auth) return { error: NOT_SIGNED_IN };
  const { supabase, user } = auth;
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is blocked here too.
  const role = await applyAssumedRole(me?.role);
  if (role !== "super_admin") return { error: GENERIC_ERROR };
  return { supabase };
}

function revalidateWorker(workerId: string) {
  revalidatePath(`/nova/worker/${workerId}`);
  revalidatePath("/nova");
}

export async function awardSaversBonusAction(workerId: string): Promise<WorkerActionResult> {
  if (!UUID_REGEX.test(workerId)) return { ok: false, error: GENERIC_ERROR };
  const gate = await requireSuper();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.rpc("award_savers_bonus", { p_worker: workerId });
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidateWorker(workerId);
  return { ok: true };
}

export async function confiscateCoinsAction(
  workerId: string,
  reason: ConfiscationReason,
  note?: string,
): Promise<WorkerActionResult> {
  if (!UUID_REGEX.test(workerId)) return { ok: false, error: GENERIC_ERROR };
  if (!CONFISCATION_REASONS.includes(reason)) return { ok: false, error: GENERIC_ERROR };
  const gate = await requireSuper();
  if ("error" in gate) return { ok: false, error: gate.error };
  const params: { p_worker: string; p_reason: ConfiscationReason; p_note?: string } = {
    p_worker: workerId,
    p_reason: reason,
  };
  const trimmed = note?.trim();
  if (trimmed) params.p_note = trimmed;
  const { error } = await gate.supabase.rpc("confiscate_coins", params);
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidateWorker(workerId);
  return { ok: true };
}

export async function redeemShopItemAction(
  workerId: string,
  itemId: string,
): Promise<WorkerActionResult> {
  if (!UUID_REGEX.test(workerId) || !UUID_REGEX.test(itemId)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const gate = await requireSuper();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.rpc("redeem_shop_item", {
    p_worker: workerId,
    p_item: itemId,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidateWorker(workerId);
  return { ok: true };
}
