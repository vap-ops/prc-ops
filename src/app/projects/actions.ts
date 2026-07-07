"use server";

// Spec 142 U2 — create a project from the hub. Runs under the USER session;
// the SECURITY DEFINER create_project RPC (role check inside) is the
// load-bearing authorisation. The checks here buy clean Thai errors and fast
// feedback; the gate mirrors updateProjectSettings (spec 79).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import {
  isValidProjectType,
  validateProjectCode,
  validateProjectName,
  type ProjectType,
} from "@/lib/projects/validate-settings";
import { isValidUuid } from "@/lib/validate/uuid";
import type { Database } from "@/lib/db/database.types";

const PM_ONLY_ERROR = "เฉพาะผู้จัดการโครงการเท่านั้นที่สร้างโครงการได้";

export interface CreateProjectInput {
  code: string;
  name: string;
  projectType: string; // enum value or ""
  clientId: string; // uuid or ""
}

export type CreateProjectResult = { ok: true; id: string } | { ok: false; error: string };

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const codeResult = validateProjectCode(input.code);
  if (!codeResult.ok) return { ok: false, error: codeResult.error };

  const nameResult = validateProjectName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const projectType = input.projectType.trim();
  if (projectType !== "" && !isValidProjectType(projectType)) {
    return { ok: false, error: "ประเภทโครงการไม่ถูกต้อง" };
  }
  const clientId = input.clientId.trim();
  if (clientId !== "" && !isValidUuid(clientId)) {
    return { ok: false, error: "ลูกค้าไม่ถูกต้อง" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is gated here too.
  const effectiveRole = await applyAssumedRole(userRow?.role);
  if (!effectiveRole || !PM_ROLES.includes(effectiveRole)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const rpcArgs: Database["public"]["Functions"]["create_project"]["Args"] = {
    p_code: codeResult.code,
    p_name: nameResult.name,
  };
  // Optional args OMITTED when unset (exactOptionalPropertyTypes): an absent key
  // uses the SQL default null. typegen omits arg-nullability, so cast the value.
  if (projectType !== "") rpcArgs.p_project_type = projectType as ProjectType;
  if (clientId !== "") rpcArgs.p_client_id = clientId;

  const { data: newId, error } = await supabase.rpc("create_project", rpcArgs);
  if (error) {
    console.error("[createProject] RPC failed", { code: input.code, error: error.message });
    if (error.code === "23505") {
      return { ok: false, error: "รหัสโครงการนี้มีอยู่แล้ว กรุณาใช้รหัสอื่น" };
    }
    if (error.code === "42501") return { ok: false, error: PM_ONLY_ERROR };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลโครงการไม่ถูกต้อง" };
    return { ok: false, error: "สร้างโครงการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!newId) return { ok: false, error: "สร้างโครงการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  revalidatePath("/projects");
  return { ok: true, id: newId };
}
