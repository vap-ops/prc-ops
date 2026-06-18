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
