"use server";

// Spec 273 U2 (ADR 0076) — the /sa แผนพรุ่งนี้ board actions. Each relays one U1
// SECURITY DEFINER RPC; the DB enforces authorization (role ∈ SA/PM-tier/site_owner
// AND can_see_project membership) and the leaf/same-project/one-lead guards, so the
// action only validates shape, confirms a signed-in session, and revalidates. This
// is the daily-plan layer — it never writes the master schedule or baselines.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { ISO_DATE_REGEX } from "@/lib/dates";
import { validateNotes } from "@/lib/notes/validate";

const PLAN_PATH = "/sa/plan";
const GENERIC_ERROR = "บันทึกแผนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type PlanActionResult = { ok: true } | { ok: false; error: string };

function rpcErrorToThai(message: string): string {
  if (message.includes("role not permitted")) return "ไม่มีสิทธิ์แก้ไขแผน";
  if (message.includes("not a member")) return "ไม่มีสิทธิ์ในโครงการนี้";
  if (message.includes("group")) return "เลือกงานย่อยเท่านั้น";
  if (message.includes("not in this project")) return "งานย่อยไม่อยู่ในโครงการนี้";
  return GENERIC_ERROR;
}

export async function addDailyPlanItem(
  project: string,
  date: string,
  wp: string,
): Promise<PlanActionResult> {
  if (!UUID_REGEX.test(project) || !UUID_REGEX.test(wp) || !ISO_DATE_REGEX.test(date)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("add_daily_plan_item", {
    p_project: project,
    p_date: date,
    p_wp: wp,
  });
  if (error) return { ok: false, error: rpcErrorToThai(error.message) };
  revalidatePath(PLAN_PATH);
  return { ok: true };
}

export async function removeDailyPlanItem(item: string): Promise<PlanActionResult> {
  if (!UUID_REGEX.test(item)) return { ok: false, error: GENERIC_ERROR };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("remove_daily_plan_item", { p_item: item });
  if (error) return { ok: false, error: rpcErrorToThai(error.message) };
  revalidatePath(PLAN_PATH);
  return { ok: true };
}

export async function setDailyPlanItemNote(item: string, note: string): Promise<PlanActionResult> {
  if (!UUID_REGEX.test(item)) return { ok: false, error: GENERIC_ERROR };
  const noteResult = validateNotes(note ?? "");
  if (!noteResult.ok) return { ok: false, error: noteResult.error };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("set_daily_plan_item_note", {
    p_item: item,
    p_note: noteResult.value ?? "",
  });
  if (error) return { ok: false, error: rpcErrorToThai(error.message) };
  revalidatePath(PLAN_PATH);
  return { ok: true };
}

export async function reorderDailyPlanItems(
  plan: string,
  itemIds: string[],
): Promise<PlanActionResult> {
  if (!UUID_REGEX.test(plan) || itemIds.some((id) => !UUID_REGEX.test(id))) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("reorder_daily_plan_items", {
    p_plan: plan,
    p_item_ids: itemIds,
  });
  if (error) return { ok: false, error: rpcErrorToThai(error.message) };
  revalidatePath(PLAN_PATH);
  return { ok: true };
}

export async function setDailyPlanItemCrew(
  item: string,
  workerIds: string[],
  lead: string | null,
): Promise<PlanActionResult> {
  if (!UUID_REGEX.test(item) || workerIds.some((id) => !UUID_REGEX.test(id))) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (lead !== null && !UUID_REGEX.test(lead)) return { ok: false, error: GENERIC_ERROR };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("set_daily_plan_item_crew", {
    p_item: item,
    p_worker_ids: workerIds,
    // The DB arg is nullable (no ผู้รับผิดชอบ ⇒ NULL; the RPC coalesces it), but the
    // generated Args type models function args as non-null. null reaches PG as SQL NULL.
    p_lead: lead as unknown as string,
  });
  if (error) return { ok: false, error: rpcErrorToThai(error.message) };
  revalidatePath(PLAN_PATH);
  return { ok: true };
}
