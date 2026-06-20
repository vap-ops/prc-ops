"use server";

// Spec 161 U8 — run the project lifecycle at close: settle, then distribute.
// Authorization is the DB's: settle_project (U4b) is super_admin + project_director;
// distribute_project_coins (U5) is super_admin only (minting = peak authority).
// Both relay via the RLS server client (the caller's JWT — the SECURITY DEFINER
// gates read current_user_role(), which the service-role admin client lacks).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC_ERROR = "ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type ActionResult = { ok: true } | { ok: false; error: string };

type ActionClient = NonNullable<Awaited<ReturnType<typeof getActionUser>>>["supabase"];

async function gate(
  roles: readonly string[],
): Promise<{ supabase: ActionClient } | { error: string }> {
  const auth = await getActionUser();
  if (!auth) return { error: NOT_SIGNED_IN };
  const { supabase, user } = auth;
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (!me || !roles.includes(me.role)) return { error: GENERIC_ERROR };
  return { supabase };
}

export async function settleProjectAction(projectId: string): Promise<ActionResult> {
  if (!UUID_REGEX.test(projectId)) return { ok: false, error: GENERIC_ERROR };
  const g = await gate(["super_admin", "project_director"]);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.supabase.rpc("settle_project", { p_project: projectId });
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidatePath("/nova/settlement");
  return { ok: true };
}

export async function distributeProjectCoinsAction(projectId: string): Promise<ActionResult> {
  if (!UUID_REGEX.test(projectId)) return { ok: false, error: GENERIC_ERROR };
  const g = await gate(["super_admin"]);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.supabase.rpc("distribute_project_coins", { p_project: projectId });
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidatePath("/nova/settlement");
  return { ok: true };
}

// Defect clawback (U10) — forfeit a project's still-unvested distributed coins.
// super-only; idempotent (the RPC nets prior clawbacks). p_note carries the reason.
export async function clawBackProjectAction(
  projectId: string,
  note?: string,
): Promise<ActionResult> {
  if (!UUID_REGEX.test(projectId)) return { ok: false, error: GENERIC_ERROR };
  const g = await gate(["super_admin"]);
  if ("error" in g) return { ok: false, error: g.error };
  // Omit p_note when absent (exactOptionalPropertyTypes — never pass undefined).
  const params: { p_project: string; p_note?: string } = { p_project: projectId };
  const trimmed = note?.trim();
  if (trimmed) params.p_note = trimmed;
  const { error } = await g.supabase.rpc("claw_back_project_coins", params);
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidatePath("/nova/settlement");
  return { ok: true };
}
