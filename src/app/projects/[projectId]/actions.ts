"use server";

// Spec 142 U3 — dismiss the onboarding checklist on the project page. Runs
// under the USER session; the SECURITY DEFINER dismiss_project_onboarding RPC
// (role check inside) is the load-bearing authorisation. Gate mirrors the
// other project write paths (spec 79).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { projectHref } from "@/lib/nav/project-paths";
import { isValidUuid } from "@/lib/validate/uuid";
import {
  validateWorkPackageCode,
  validateWorkPackageName,
} from "@/lib/work-packages/validate-new-wp";
import {
  validateDeliverableCode,
  validateDeliverableName,
} from "@/lib/deliverables/validate-new-deliverable";
import { validateCategoryCode, validateCategoryName } from "@/lib/categories/validate";
import { parseAndValidate } from "@/lib/wp-import/parse";
import type { Database } from "@/lib/db/database.types";

const PM_ONLY_ERROR = "เฉพาะผู้จัดการโครงการเท่านั้น";
// Spec 145: the work_packages BEFORE INSERT trigger raises P0002 on a closed
// (completed/archived) project.
const PROJECT_CLOSED_ERROR = "โครงการนี้ปิดแล้ว เปิดโครงการก่อนจึงจะเพิ่มหรือนำเข้างานได้";

// Spec 207 U3 — create a per-project work-category (หมวดงาน). Shape-validate +
// relay; the SECURITY DEFINER create_project_category RPC is the load-bearing
// authorisation (null-safe role gate pm/super/director + can_see_project
// membership), so this action does NOT re-read the role — it maps the RPC's
// error codes. sort_order appends to the end (current max + 1, read under the
// caller's RLS — a member can see the project's categories).
export interface CreateProjectCategoryInput {
  projectId: string;
  code: string;
  name: string;
}

export type CreateProjectCategoryResult = { ok: true; id: string } | { ok: false; error: string };

export async function createProjectCategory(
  input: CreateProjectCategoryInput,
): Promise<CreateProjectCategoryResult> {
  if (!isValidUuid(input.projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };

  const codeResult = validateCategoryCode(input.code);
  if (!codeResult.ok) return { ok: false, error: codeResult.error };
  const nameResult = validateCategoryName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  // Append to the end. A non-member's RLS read returns nothing → sort_order 0,
  // and the RPC then rejects with 42501 (mapped below) — no leak.
  const { data: lastRow } = await supabase
    .from("project_categories")
    .select("sort_order")
    .eq("project_id", input.projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (lastRow?.sort_order ?? -1) + 1;

  const { data: newId, error } = await supabase.rpc("create_project_category", {
    p_project_id: input.projectId,
    p_code: codeResult.code,
    p_name: nameResult.name,
    p_sort_order: nextSortOrder,
  });
  if (error) {
    console.error("[createProjectCategory] RPC failed", {
      projectId: input.projectId,
      error: error.message,
    });
    if (error.code === "23505")
      return { ok: false, error: "รหัสหมวดนี้มีอยู่แล้วในโครงการ กรุณาใช้รหัสอื่น" };
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลหมวดงานไม่ถูกต้อง" };
    return { ok: false, error: "เพิ่มหมวดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!newId) return { ok: false, error: "เพิ่มหมวดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  revalidatePath(projectHref(input.projectId));
  return { ok: true, id: newId };
}

export type DismissOnboardingResult = { ok: true } | { ok: false; error: string };

export async function dismissProjectOnboarding(
  projectId: string,
): Promise<DismissOnboardingResult> {
  if (!isValidUuid(projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const { data, error } = await supabase.rpc("dismiss_project_onboarding", {
    p_project_id: projectId,
  });
  if (error) {
    console.error("[dismissProjectOnboarding] RPC failed", { projectId, error: error.message });
    return { ok: false, error: "ซ่อนรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (data !== true) return { ok: false, error: "ไม่พบโครงการ" };

  revalidatePath(projectHref(projectId));
  return { ok: true };
}

// Spec 142 U4 — create a work package under the project. Gate mirrors the other
// project write paths; the SECURITY DEFINER create_work_package RPC is the
// load-bearing authorisation.
export interface CreateWorkPackageInput {
  projectId: string;
  code: string;
  name: string;
  description: string;
}

export type CreateWorkPackageResult = { ok: true; id: string } | { ok: false; error: string };

export async function createWorkPackage(
  input: CreateWorkPackageInput,
): Promise<CreateWorkPackageResult> {
  if (!isValidUuid(input.projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };

  const codeResult = validateWorkPackageCode(input.code);
  if (!codeResult.ok) return { ok: false, error: codeResult.error };
  const nameResult = validateWorkPackageName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };
  const description = input.description.trim();

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const rpcArgs: Database["public"]["Functions"]["create_work_package"]["Args"] = {
    p_project_id: input.projectId,
    p_code: codeResult.code,
    p_name: nameResult.name,
  };
  // exactOptionalPropertyTypes: omit the key rather than pass undefined.
  if (description !== "") rpcArgs.p_description = description;

  const { data: newId, error } = await supabase.rpc("create_work_package", rpcArgs);
  if (error) {
    console.error("[createWorkPackage] RPC failed", {
      projectId: input.projectId,
      error: error.message,
    });
    if (error.code === "23505") {
      return { ok: false, error: "รหัสงานนี้มีอยู่แล้วในโครงการ กรุณาใช้รหัสอื่น" };
    }
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "P0002") return { ok: false, error: PROJECT_CLOSED_ERROR };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลงานไม่ถูกต้อง" };
    return { ok: false, error: "เพิ่มรายการงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!newId) return { ok: false, error: "เพิ่มรายการงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  revalidatePath(projectHref(input.projectId));
  return { ok: true, id: newId };
}

// Spec 142 U6 — copy the work-package skeleton from another project. Gate mirrors
// the other project writes; the SECURITY DEFINER clone_work_packages RPC is the
// load-bearing authorisation.
export type CopyWorkPackagesResult = { ok: true; count: number } | { ok: false; error: string };

export async function copyWorkPackages(
  sourceProjectId: string,
  projectId: string,
): Promise<CopyWorkPackagesResult> {
  if (!isValidUuid(sourceProjectId) || !isValidUuid(projectId)) {
    return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  }
  if (sourceProjectId === projectId) {
    return { ok: false, error: "เลือกโครงการอื่นเป็นต้นทาง" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const { data: count, error } = await supabase.rpc("clone_work_packages", {
    p_src_project_id: sourceProjectId,
    p_dst_project_id: projectId,
  });
  if (error) {
    console.error("[copyWorkPackages] RPC failed", { projectId, error: error.message });
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "P0002") return { ok: false, error: PROJECT_CLOSED_ERROR };
    if (error.code === "22023") return { ok: false, error: "เลือกโครงการต้นทางไม่ถูกต้อง" };
    return { ok: false, error: "คัดลอกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(projectHref(projectId));
  return { ok: true, count: count ?? 0 };
}

// Spec 142 U7 — import work packages from pasted CSV. Reuses the wp-import
// parser (ADR 0014); valid rows are created via create_work_package (U4). Gate
// mirrors the other project writes.
export type ImportWorkPackagesResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

export async function importWorkPackagesCsv(
  projectId: string,
  csvText: string,
): Promise<ImportWorkPackagesResult> {
  if (!isValidUuid(projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  // Existing codes for dup detection (PM is a member → RLS lets it read these).
  const { data: existing } = await supabase
    .from("work_packages")
    .select("code")
    .eq("project_id", projectId);
  const existingCodes = new Set((existing ?? []).map((w) => w.code));

  const { rows, errors } = parseAndValidate(csvText, existingCodes);
  if (errors.length > 0) {
    // Surface the first few; the textarea lets the user fix and retry.
    return { ok: false, error: errors.slice(0, 8).join("\n") };
  }
  if (rows.length === 0) {
    return { ok: false, error: "ไม่พบรายการงาน (วางรหัสและชื่องาน หนึ่งงานต่อหนึ่งบรรทัด)" };
  }

  // Pre-validated rows → create each via the U4 RPC (definer; sidesteps the
  // work_packages table-grant). Sequential so a mid-batch failure reports how
  // far it got rather than racing.
  let inserted = 0;
  for (const r of rows) {
    const args: Database["public"]["Functions"]["create_work_package"]["Args"] = {
      p_project_id: projectId,
      p_code: r.code,
      p_name: r.name,
    };
    if (r.description !== null) args.p_description = r.description;
    const { error } = await supabase.rpc("create_work_package", args);
    if (error) {
      console.error("[importWorkPackagesCsv] RPC failed", { projectId, error: error.message });
      if (error.code === "P0002") return { ok: false, error: PROJECT_CLOSED_ERROR };
      if (inserted > 0) revalidatePath(projectHref(projectId));
      return { ok: false, error: `นำเข้าได้ ${inserted} รายการ จากนั้นเกิดข้อผิดพลาด` };
    }
    inserted++;
  }

  revalidatePath(projectHref(projectId));
  return { ok: true, inserted };
}

// Spec 164 U1 — create a งวดงาน (deliverable) under the project. Gate mirrors
// the other project writes; the SECURITY DEFINER create_deliverable RPC is the
// load-bearing authorisation. sort_order is auto-assigned in the RPC.
export interface CreateDeliverableInput {
  projectId: string;
  code: string;
  name: string;
}

export type CreateDeliverableResult = { ok: true; id: string } | { ok: false; error: string };

export async function createDeliverable(
  input: CreateDeliverableInput,
): Promise<CreateDeliverableResult> {
  if (!isValidUuid(input.projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };

  const codeResult = validateDeliverableCode(input.code);
  if (!codeResult.ok) return { ok: false, error: codeResult.error };
  const nameResult = validateDeliverableName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const { data: newId, error } = await supabase.rpc("create_deliverable", {
    p_project_id: input.projectId,
    p_code: codeResult.code,
    p_name: nameResult.name,
  });
  if (error) {
    console.error("[createDeliverable] RPC failed", {
      projectId: input.projectId,
      error: error.message,
    });
    if (error.code === "23505")
      return { ok: false, error: "รหัสงวดนี้มีอยู่แล้วในโครงการ กรุณาใช้รหัสอื่น" };
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลงวดไม่ถูกต้อง" };
    return { ok: false, error: "เพิ่มงวดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!newId) return { ok: false, error: "เพิ่มงวดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  revalidatePath(projectHref(input.projectId));
  return { ok: true, id: newId };
}

// Spec 164 U2 — bulk-paste a งวด list. Reuses the spec-163 parser (tab/comma +
// header auto-detect; the description column is ignored for งวด); valid rows are
// created via create_deliverable (U1). Gate mirrors the other project writes.
export type ImportDeliverablesResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

export async function importDeliverables(
  projectId: string,
  text: string,
): Promise<ImportDeliverablesResult> {
  if (!isValidUuid(projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  // Existing งวด codes for dup detection (PM is a member → RLS lets it read).
  const { data: existing } = await supabase
    .from("deliverables")
    .select("code")
    .eq("project_id", projectId);
  const existingCodes = new Set((existing ?? []).map((d) => d.code));

  const { rows, errors } = parseAndValidate(text, existingCodes);
  if (errors.length > 0) {
    return { ok: false, error: errors.slice(0, 8).join("\n") };
  }
  if (rows.length === 0) {
    return { ok: false, error: "ไม่พบรายการงวด (วางรหัสและชื่องวด หนึ่งงวดต่อหนึ่งบรรทัด)" };
  }

  // Pre-validated rows → create each via the U1 RPC. Sequential so a mid-batch
  // failure reports how far it got, and sort_order (max+1) increments in order.
  let inserted = 0;
  for (const r of rows) {
    const { error } = await supabase.rpc("create_deliverable", {
      p_project_id: projectId,
      p_code: r.code,
      p_name: r.name,
    });
    if (error) {
      console.error("[importDeliverables] RPC failed", { projectId, error: error.message });
      if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
      if (inserted > 0) revalidatePath(projectHref(projectId));
      return { ok: false, error: `นำเข้าได้ ${inserted} งวด จากนั้นเกิดข้อผิดพลาด` };
    }
    inserted++;
  }

  revalidatePath(projectHref(projectId));
  return { ok: true, inserted };
}

// Spec 164 U3 — bulk-assign work packages to a งวด. Loops the spec-155
// set_work_package_deliverable RPC (membership-gated; the PM doing this is a
// member, so can_see_wp passes). One round-trip per WP — fine for a selection;
// a bulk RPC is a later optimisation. Gate mirrors the other project writes.
export type AssignDeliverableResult = { ok: true; count: number } | { ok: false; error: string };

export async function assignWorkPackagesToDeliverable(
  projectId: string,
  workPackageIds: string[],
  deliverableId: string,
): Promise<AssignDeliverableResult> {
  if (!isValidUuid(projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  if (!isValidUuid(deliverableId)) return { ok: false, error: "เลือกงวดปลายทางไม่ถูกต้อง" };
  const ids = workPackageIds.filter((id) => isValidUuid(id));
  if (ids.length === 0) return { ok: false, error: "เลือกงานอย่างน้อยหนึ่งรายการ" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  // Sequential so a mid-batch failure reports how far it got.
  let count = 0;
  for (const id of ids) {
    const { error } = await supabase.rpc("set_work_package_deliverable", {
      p_work_package_id: id,
      p_deliverable_id: deliverableId,
    });
    if (error) {
      console.error("[assignWorkPackagesToDeliverable] RPC failed", {
        projectId,
        error: error.message,
      });
      if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
      if (error.code === "22023") return { ok: false, error: "เลือกงวดปลายทางไม่ถูกต้อง" };
      if (count > 0) revalidatePath(projectHref(projectId));
      return { ok: false, error: `ย้ายได้ ${count} งาน จากนั้นเกิดข้อผิดพลาด` };
    }
    count++;
  }

  revalidatePath(projectHref(projectId));
  return { ok: true, count };
}

// Spec 165 U1 — rename a งวด. Gate mirrors the other project writes; the
// SECURITY DEFINER set_deliverable_name RPC (membership-gated) is load-bearing.
export interface SetDeliverableNameInput {
  projectId: string;
  deliverableId: string;
  name: string;
}

export type SetDeliverableNameResult = { ok: true } | { ok: false; error: string };

export async function setDeliverableName(
  input: SetDeliverableNameInput,
): Promise<SetDeliverableNameResult> {
  if (!isValidUuid(input.projectId) || !isValidUuid(input.deliverableId)) {
    return { ok: false, error: "รหัสไม่ถูกต้อง" };
  }
  const nameResult = validateDeliverableName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const { data: ok, error } = await supabase.rpc("set_deliverable_name", {
    p_deliverable_id: input.deliverableId,
    p_name: nameResult.name,
  });
  if (error) {
    console.error("[setDeliverableName] RPC failed", {
      projectId: input.projectId,
      error: error.message,
    });
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลงวดไม่ถูกต้อง" };
    return { ok: false, error: "เปลี่ยนชื่องวดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (ok !== true) return { ok: false, error: "ไม่พบงวดงาน" };

  revalidatePath(projectHref(input.projectId));
  return { ok: true };
}

// Spec 165 U2 — reorder งวด by swapping a งวด with its neighbour. Gate mirrors the
// other project writes; the SECURITY DEFINER swap_deliverable_order RPC is
// load-bearing. The UI passes the row + its prev/next id.
export type SwapDeliverableOrderResult = { ok: true } | { ok: false; error: string };

export async function swapDeliverableOrder(
  projectId: string,
  aId: string,
  bId: string,
): Promise<SwapDeliverableOrderResult> {
  if (!isValidUuid(projectId) || !isValidUuid(aId) || !isValidUuid(bId)) {
    return { ok: false, error: "รหัสไม่ถูกต้อง" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const { error } = await supabase.rpc("swap_deliverable_order", { p_a: aId, p_b: bId });
  if (error) {
    console.error("[swapDeliverableOrder] RPC failed", { projectId, error: error.message });
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    return { ok: false, error: "เรียงลำดับงวดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(projectHref(projectId));
  return { ok: true };
}

// Spec 165 U4 — delete an EMPTY งวด. Gate mirrors the other project writes; the
// SECURITY DEFINER delete_deliverable RPC (empty-only, membership-gated) is
// load-bearing. P0001 = the งวด still has งาน.
export interface DeleteDeliverableInput {
  projectId: string;
  deliverableId: string;
}

export type DeleteDeliverableResult = { ok: true } | { ok: false; error: string };

export async function deleteDeliverable(
  input: DeleteDeliverableInput,
): Promise<DeleteDeliverableResult> {
  if (!isValidUuid(input.projectId) || !isValidUuid(input.deliverableId)) {
    return { ok: false, error: "รหัสไม่ถูกต้อง" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const { data: ok, error } = await supabase.rpc("delete_deliverable", {
    p_deliverable_id: input.deliverableId,
  });
  if (error) {
    console.error("[deleteDeliverable] RPC failed", {
      projectId: input.projectId,
      error: error.message,
    });
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "P0002")
      return { ok: false, error: "งวดนี้ยังมีงาน เอางานออกจากงวดก่อนจึงจะลบได้" };
    if (error.code === "P0001")
      return { ok: false, error: "งวดนี้ยังมีงาน เอางานออกจากงวดก่อนจึงจะลบได้" };
    return { ok: false, error: "ลบงวดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (ok !== true) return { ok: false, error: "ไม่พบงวดงาน" };

  revalidatePath(projectHref(input.projectId));
  return { ok: true };
}

// Spec 165 U4 — remove (ungroup) งาน from a งวด, so it can be emptied and
// deleted. Loops the spec-155 set_work_package_deliverable RPC with a NULL
// deliverable (= ungroup). Gate mirrors the other project writes.
export type RemoveFromDeliverableResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export async function removeWorkPackagesFromDeliverable(
  projectId: string,
  workPackageIds: string[],
): Promise<RemoveFromDeliverableResult> {
  if (!isValidUuid(projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  const ids = workPackageIds.filter((id) => isValidUuid(id));
  if (ids.length === 0) return { ok: false, error: "เลือกงานอย่างน้อยหนึ่งรายการ" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  // Sequential; p_deliverable_id omitted → the RPC default (null) ungroups.
  let count = 0;
  for (const id of ids) {
    const { error } = await supabase.rpc("set_work_package_deliverable", {
      p_work_package_id: id,
    });
    if (error) {
      console.error("[removeWorkPackagesFromDeliverable] RPC failed", {
        projectId,
        error: error.message,
      });
      if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
      if (count > 0) revalidatePath(projectHref(projectId));
      return { ok: false, error: `เอาออกได้ ${count} งาน จากนั้นเกิดข้อผิดพลาด` };
    }
    count++;
  }

  revalidatePath(projectHref(projectId));
  return { ok: true, count };
}
