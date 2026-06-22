"use server";

// Spec 176 U2 — supply-plan planning actions. add: get-or-create the project's
// plan (create_supply_plan) then add a line (add_supply_plan_line); remove: drop
// a draft line. The SECURITY DEFINER RPCs carry the planner-tier + membership +
// draft-only gates; this maps their error codes for the UI.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { supplyPlanHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type SupplyPlanResult = { ok: true } | { ok: false; error: string };

const FAILED = "บันทึกแผนจัดหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NO_PERMISSION = "ไม่มีสิทธิ์ (เฉพาะผู้จัดการโครงการ)";

export async function addPlanLine(input: {
  projectId: string;
  catalogItemId: string;
  workPackageId: string;
  qty: number;
  note: string;
}): Promise<SupplyPlanResult> {
  if (
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.catalogItemId) ||
    !UUID_REGEX.test(input.workPackageId)
  ) {
    return { ok: false, error: FAILED };
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "จำนวนต้องมากกว่า 0" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  // Get-or-create the project's plan (idempotent).
  const { data: planId, error: planErr } = await supabase.rpc("create_supply_plan", {
    p_project_id: input.projectId,
  });
  if (planErr || !planId) {
    if (planErr?.code === "42501") return { ok: false, error: NO_PERMISSION };
    return { ok: false, error: FAILED };
  }

  const { error } = await supabase.rpc("add_supply_plan_line", {
    p_plan_id: planId,
    p_catalog_item_id: input.catalogItemId,
    p_work_package_id: input.workPackageId,
    p_qty: input.qty,
    p_note: input.note,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "วางแผนวัสดุนี้สำหรับงานนี้แล้ว (แก้จำนวนแทน)" };
    }
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลไม่ถูกต้อง หรือแผนถูกล็อกแล้ว" };
    return { ok: false, error: FAILED };
  }

  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true };
}

export async function removePlanLine(input: {
  projectId: string;
  lineId: string;
}): Promise<SupplyPlanResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.lineId)) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("remove_supply_plan_line", { p_line_id: input.lineId });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") return { ok: false, error: "ไม่พบรายการ หรือแผนถูกล็อกแล้ว" };
    return { ok: false, error: FAILED };
  }

  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true };
}

// Lifecycle transitions (U3). submit = planner; approve/reject = PD/super — the
// SECURITY DEFINER RPCs enforce that + the status guard; this maps their codes.
function mapLifecycleError(code?: string): string {
  if (code === "42501") return NO_PERMISSION;
  if (code === "22023") return "ทำรายการไม่ได้ในสถานะนี้";
  return FAILED;
}

export async function submitPlan(input: {
  projectId: string;
  planId: string;
}): Promise<SupplyPlanResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.planId)) {
    return { ok: false, error: FAILED };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("submit_supply_plan", { p_plan_id: input.planId });
  if (error) return { ok: false, error: mapLifecycleError(error.code) };
  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true };
}

export async function approvePlan(input: {
  projectId: string;
  planId: string;
}): Promise<SupplyPlanResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.planId)) {
    return { ok: false, error: FAILED };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("approve_supply_plan", { p_plan_id: input.planId });
  if (error) return { ok: false, error: mapLifecycleError(error.code) };
  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true };
}

export async function rejectPlan(input: {
  projectId: string;
  planId: string;
}): Promise<SupplyPlanResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.planId)) {
    return { ok: false, error: FAILED };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("reject_supply_plan", { p_plan_id: input.planId });
  if (error) return { ok: false, error: mapLifecycleError(error.code) };
  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true };
}
