"use server";

// updateProjectSettings: the back-office project edit path (spec 58 /
// ADR 0042). Runs under the USER session — the SECURITY DEFINER RPC is
// the load-bearing authorisation layer (role check + name validation
// inside); the explicit checks here only buy clean Thai errors.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import {
  isValidProjectStatus,
  validateProjectName,
  type ProjectStatus,
} from "@/lib/projects/validate-settings";
import { validateNotes } from "@/lib/notes/validate";
import { isValidUuid } from "@/lib/validate/uuid";

export interface UpdateProjectSettingsInput {
  projectId: string;
  name: string;
  status: ProjectStatus;
  // Spec 72: editable backup note, batched into the settings save.
  notes: string;
}

export type UpdateProjectSettingsResult = { ok: true } | { ok: false; error: string };

export async function updateProjectSettings(
  input: UpdateProjectSettingsInput,
): Promise<UpdateProjectSettingsResult> {
  if (!isValidUuid(input.projectId)) {
    return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  }
  if (!isValidProjectStatus(input.status)) {
    return { ok: false, error: "สถานะโครงการไม่ถูกต้อง" };
  }
  const nameResult = validateProjectName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const notesResult = validateNotes(input.notes);
  if (!notesResult.ok) return { ok: false, error: notesResult.error };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่แก้ไขโครงการได้" };
  }

  const { data: updated, error: rpcError } = await supabase.rpc("update_project_settings", {
    p_project_id: input.projectId,
    p_name: nameResult.name,
    p_status: input.status,
    // Empty string clears the note (the RPC's coalesce-preserve maps "" → null,
    // and null would preserve — so pass "" explicitly, never null, to allow clearing).
    p_notes: notesResult.value ?? "",
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
