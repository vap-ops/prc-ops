"use server";

// Spec 161 U7 — calibrate the Nova economic dials. Authorization is the DB's:
// set_nova_dial (U4a) + set_sell_rate (U1) are SECURITY DEFINER, super_admin only.
// These actions validate shape, re-check the role (defence in depth), and relay via
// the RLS server client — NOT the admin client: the setter gates read
// current_user_role() off the caller's JWT, which only the user session carries
// (the admin/service-role client has no auth context → the gate would deny it).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import { WORKER_LEVEL_ORDER, type WorkerLevel } from "@/lib/nova/dials";

const GENERIC_ERROR = "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NEGATIVE_ERROR = "ค่าต้องไม่ติดลบ";

export type SaveResult = { ok: true } | { ok: false; error: string };

type ActionClient = NonNullable<Awaited<ReturnType<typeof getActionUser>>>["supabase"];
type Gate = { supabase: ActionClient } | { error: string };

async function requireSuper(): Promise<Gate> {
  const auth = await getActionUser();
  if (!auth) return { error: NOT_SIGNED_IN };
  const { supabase, user } = auth;
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is blocked here too.
  const role = await applyAssumedRole(me?.role);
  if (role !== "super_admin") return { error: GENERIC_ERROR };
  return { supabase };
}

export async function setNovaDial(key: string, value: number): Promise<SaveResult> {
  if (typeof key !== "string" || key.trim().length === 0)
    return { ok: false, error: GENERIC_ERROR };
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: NEGATIVE_ERROR };

  const gate = await requireSuper();
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.supabase.rpc("set_nova_dial", { p_key: key, p_value: value });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/nova/dials");
  return { ok: true };
}

export async function setSellRate(
  level: WorkerLevel,
  costBand: number,
  internalSell: number,
  externalSell: number,
): Promise<SaveResult> {
  if (!WORKER_LEVEL_ORDER.includes(level)) return { ok: false, error: GENERIC_ERROR };
  for (const v of [costBand, internalSell, externalSell]) {
    if (!Number.isFinite(v) || v < 0) return { ok: false, error: NEGATIVE_ERROR };
  }

  const gate = await requireSuper();
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.supabase.rpc("set_sell_rate", {
    p_level: level,
    p_cost_band: costBand,
    p_internal_sell: internalSell,
    p_external_sell: externalSell,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/nova/dials");
  return { ok: true };
}
