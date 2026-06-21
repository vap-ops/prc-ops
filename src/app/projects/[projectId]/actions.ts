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
import { parseAndValidate } from "@/lib/wp-import/parse";
import type { Database } from "@/lib/db/database.types";

const PM_ONLY_ERROR = "เฉพาะผู้จัดการโครงการเท่านั้น";
// Spec 145: the work_packages BEFORE INSERT trigger raises P0002 on a closed
// (completed/archived) project.
const PROJECT_CLOSED_ERROR = "โครงการนี้ปิดแล้ว เปิดโครงการก่อนจึงจะเพิ่มหรือนำเข้างานได้";

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

// Spec 142 U5 — seed a project's work packages from its project_type's template.
// Gate mirrors the other project writes; apply_wp_template (SECURITY DEFINER) is
// the load-bearing authorisation.
export type ApplyTemplateResult = { ok: true; inserted: number } | { ok: false; error: string };

export async function applyWpTemplate(projectId: string): Promise<ApplyTemplateResult> {
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

  const { data: inserted, error } = await supabase.rpc("apply_wp_template", {
    p_project_id: projectId,
  });
  if (error) {
    console.error("[applyWpTemplate] RPC failed", { projectId, error: error.message });
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "P0002") return { ok: false, error: PROJECT_CLOSED_ERROR };
    if (error.code === "22023") return { ok: false, error: "ไม่พบโครงการ" };
    return { ok: false, error: "ใช้เทมเพลตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(projectHref(projectId));
  return { ok: true, inserted: inserted ?? 0 };
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
