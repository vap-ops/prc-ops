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
import { mapTemplateLinesToClonePayload } from "@/lib/supply-plan/clone-template";

export type SupplyPlanResult = { ok: true } | { ok: false; error: string };

const FAILED = "บันทึกแผนจัดหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NO_PERMISSION = "ไม่มีสิทธิ์ (เฉพาะผู้จัดการโครงการ)";

// Spec 189 — create a NEW draft supply plan for a project (a project may have
// many). The planning UI's "new plan" button calls this, then navigates to the
// fresh plan. create_supply_plan carries the planner-tier + membership gates.
export async function createPlan(input: {
  projectId: string;
}): Promise<SupplyPlanResult & { planId?: string }> {
  if (!UUID_REGEX.test(input.projectId)) return { ok: false, error: FAILED };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data: planId, error } = await auth.supabase.rpc("create_supply_plan", {
    p_project_id: input.projectId,
  });
  if (error || !planId) {
    if (error?.code === "42501") return { ok: false, error: NO_PERMISSION };
    return { ok: false, error: FAILED };
  }

  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true, planId };
}

// Spec 245 U2 — clone a global template (is_template=true) into a fresh draft
// plan for a project. Zero new RPCs: create_supply_plan (always fresh, spec
// 189) + a plain select of the template's lines (permitted by the spec 245 U1
// RLS branch) + add_supply_plan_lines (the ATOMIC bulk RPC — never the
// singular add_supply_plan_line, which still carries the pre-U1 null-check bug
// against a template). If the add step fails, the fresh plan from step 1 is
// left behind as a harmless empty draft (spec 245 §5) — not auto-deleted.
export async function cloneSupplyPlanTemplate(input: {
  templateId: string;
  projectId: string;
}): Promise<SupplyPlanResult & { planId?: string }> {
  if (!UUID_REGEX.test(input.templateId) || !UUID_REGEX.test(input.projectId)) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data: planId, error: createError } = await supabase.rpc("create_supply_plan", {
    p_project_id: input.projectId,
  });
  if (createError || !planId) {
    if (createError?.code === "42501") return { ok: false, error: NO_PERMISSION };
    return { ok: false, error: FAILED };
  }

  const { data: templateLines, error: readError } = await supabase
    .from("supply_plan_lines")
    .select("catalog_item_id, qty, note")
    .eq("supply_plan_id", input.templateId);
  if (readError) return { ok: false, error: FAILED };

  if (!templateLines || templateLines.length === 0) {
    revalidatePath(supplyPlanHref(input.projectId));
    return { ok: true, planId };
  }

  const payload = mapTemplateLinesToClonePayload(
    templateLines.map((l) => ({
      catalogItemId: l.catalog_item_id,
      qty: Number(l.qty),
      note: l.note,
    })),
  );

  const { error: addError } = await supabase.rpc("add_supply_plan_lines", {
    p_plan_id: planId,
    p_lines: payload.map((l) => ({
      catalog_item_id: l.catalogItemId,
      work_package_id: l.workPackageId,
      qty: l.qty,
      note: l.note,
    })),
  });
  if (addError) {
    if (addError.code === "42501") return { ok: false, error: NO_PERMISSION };
    return { ok: false, error: FAILED };
  }

  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true, planId };
}

// Spec 189 follow-up — delete a DRAFT/REJECTED supply plan. delete_supply_plan
// carries the planner-tier + membership gates and the editable-only guard.
export async function deletePlan(input: {
  projectId: string;
  planId: string;
}): Promise<SupplyPlanResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.planId)) {
    return { ok: false, error: FAILED };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("delete_supply_plan", { p_plan_id: input.planId });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") {
      return { ok: false, error: "ลบได้เฉพาะแผนฉบับร่างหรือแผนที่ถูกตีกลับ" };
    }
    return { ok: false, error: FAILED };
  }
  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true };
}

export async function addPlanLine(input: {
  projectId: string;
  planId: string;
  catalogItemId: string;
  workPackageId: string;
  qty: number;
  note: string;
}): Promise<SupplyPlanResult> {
  if (
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.planId) ||
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

  // Spec 189: lines target the explicit plan (the page picks/creates it).
  const { error } = await supabase.rpc("add_supply_plan_line", {
    p_plan_id: input.planId,
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

// Spec 181 U2 — the inline grid saves many lines at once. Get-or-create the
// plan, then bulk-insert via add_supply_plan_lines (atomic — any bad line rolls
// the whole batch back). work_package_id is optional (null = whole-project).
export async function bulkAddPlanLines(input: {
  projectId: string;
  planId: string;
  lines: Array<{
    catalogItemId: string;
    workPackageId: string | null;
    qty: number;
    note: string;
  }>;
}): Promise<SupplyPlanResult & { count?: number }> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.planId)) {
    return { ok: false, error: FAILED };
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: "ยังไม่มีรายการที่จะบันทึก" };
  }
  for (const l of input.lines) {
    if (!UUID_REGEX.test(l.catalogItemId)) return { ok: false, error: "เลือกวัสดุให้ครบทุกแถว" };
    if (l.workPackageId !== null && !UUID_REGEX.test(l.workPackageId)) {
      return { ok: false, error: FAILED };
    }
    if (!Number.isFinite(l.qty) || l.qty <= 0) {
      return { ok: false, error: "จำนวนต้องมากกว่า 0 ทุกแถว" };
    }
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  // Spec 189: lines target the explicit plan (the page picks/creates it).
  const { data: count, error } = await supabase.rpc("add_supply_plan_lines", {
    p_plan_id: input.planId,
    p_lines: input.lines.map((l) => ({
      catalog_item_id: l.catalogItemId,
      work_package_id: l.workPackageId,
      qty: l.qty,
      note: l.note,
    })),
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "มีวัสดุซ้ำสำหรับงานเดียวกัน (รวมกับที่วางแผนไว้แล้ว)" };
    }
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลไม่ถูกต้อง หรือแผนถูกล็อกแล้ว" };
    return { ok: false, error: FAILED };
  }

  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true, count: typeof count === "number" ? count : input.lines.length };
}

// Spec 181 U3 — generate purchase requests from an APPROVED plan's selected
// lines (the "bulk PR" step). Relays generate_purchase_requests_from_plan, which
// gates PM/super/director/procurement, requires an approved plan, and creates
// born-approved PRs idempotently. Returns the count created.
export async function generatePlanPurchaseRequests(input: {
  projectId: string;
  planId: string;
  lineIds: string[];
}): Promise<SupplyPlanResult & { count?: number }> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.planId)) {
    return { ok: false, error: FAILED };
  }
  if (!Array.isArray(input.lineIds) || input.lineIds.length === 0) {
    return { ok: false, error: "เลือกรายการที่จะสร้างคำขอซื้อ" };
  }
  if (!input.lineIds.every((id) => UUID_REGEX.test(id))) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data: count, error } = await auth.supabase.rpc("generate_purchase_requests_from_plan", {
    p_plan_id: input.planId,
    p_line_ids: input.lineIds,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") {
      // Spec 195 P2: whole-project lines are allowed now — 22023 means the plan
      // isn't approved (or no lines / unknown plan).
      return { ok: false, error: "สร้างคำขอซื้อไม่ได้: แผนต้องอนุมัติก่อน" };
    }
    return { ok: false, error: FAILED };
  }

  revalidatePath(supplyPlanHref(input.projectId));
  revalidatePath("/requests");
  return { ok: true, count: typeof count === "number" ? count : input.lineIds.length };
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

// Spec 194 — super_admin override: reopen a submitted/approved (frozen) plan back
// to draft (editable), stamped overridden_by. super-only (the RPC enforces it).
export async function reopenPlan(input: {
  projectId: string;
  planId: string;
}): Promise<SupplyPlanResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.planId)) {
    return { ok: false, error: FAILED };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("reopen_supply_plan", { p_plan_id: input.planId });
  if (error) return { ok: false, error: mapLifecycleError(error.code) };
  revalidatePath(supplyPlanHref(input.projectId));
  return { ok: true };
}
