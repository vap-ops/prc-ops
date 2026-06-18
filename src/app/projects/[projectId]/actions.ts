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
import type { Database } from "@/lib/db/database.types";

const PM_ONLY_ERROR = "เฉพาะผู้จัดการโครงการเท่านั้น";

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
    if (error.code === "22023") return { ok: false, error: "เลือกโครงการต้นทางไม่ถูกต้อง" };
    return { ok: false, error: "คัดลอกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(projectHref(projectId));
  return { ok: true, count: count ?? 0 };
}
