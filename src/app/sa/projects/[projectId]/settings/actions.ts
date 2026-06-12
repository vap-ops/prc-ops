"use server";

// updateProjectSettings: the back-office project edit path (spec 58 /
// ADR 0042). Runs under the USER session — the SECURITY DEFINER RPC is
// the load-bearing authorisation layer (role check + name validation
// inside); the explicit checks here only buy clean Thai errors.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import {
  isValidProjectStatus,
  validateProjectName,
  type ProjectStatus,
} from "@/lib/projects/validate-settings";
import type { UserRole } from "@/lib/auth/role-home";

const BACK_OFFICE_PROJECT_ROLES: ReadonlyArray<UserRole> = ["project_manager", "super_admin"];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UpdateProjectSettingsInput {
  projectId: string;
  name: string;
  status: ProjectStatus;
}

export type UpdateProjectSettingsResult = { ok: true } | { ok: false; error: string };

export async function updateProjectSettings(
  input: UpdateProjectSettingsInput,
): Promise<UpdateProjectSettingsResult> {
  if (typeof input.projectId !== "string" || !UUID_REGEX.test(input.projectId)) {
    return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  }
  if (!isValidProjectStatus(input.status)) {
    return { ok: false, error: "สถานะโครงการไม่ถูกต้อง" };
  }
  const nameResult = validateProjectName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !(BACK_OFFICE_PROJECT_ROLES as readonly string[]).includes(userRow.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่แก้ไขโครงการได้" };
  }

  const { data: updated, error: rpcError } = await supabase.rpc("update_project_settings", {
    p_project_id: input.projectId,
    p_name: nameResult.name,
    p_status: input.status,
  });
  if (rpcError) {
    console.error("[updateProjectSettings] RPC failed", {
      projectId: input.projectId,
      error: rpcError.message,
    });
    return { ok: false, error: "บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (updated !== true) return { ok: false, error: "ไม่พบโครงการ" };

  revalidatePath("/sa");
  revalidatePath(`/sa/projects/${input.projectId}`);
  revalidatePath(`/sa/projects/${input.projectId}/settings`);
  return { ok: true };
}
