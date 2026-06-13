"use server";

// Project-settings write paths (spec 58 / 79, ADR 0042). All run under the
// USER session — the SECURITY DEFINER RPCs are the load-bearing authorisation
// (role check inside); the checks here buy clean Thai errors and fast feedback.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { projectHref, projectSettingsHref } from "@/lib/nav/project-paths";
import {
  isValidProjectStatus,
  isValidProjectType,
  validateProjectName,
  validateSiteAddress,
  validateBudgetAmount,
  validateProjectDates,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/projects/validate-settings";
import { validateNotes } from "@/lib/notes/validate";
import { isValidUuid } from "@/lib/validate/uuid";
import type { Database } from "@/lib/db/database.types";

const PM_ONLY_ERROR = "เฉพาะผู้จัดการโครงการเท่านั้นที่แก้ไขโครงการได้";
const CLIENT_NAME_MAX = 200;

export interface UpdateProjectSettingsInput {
  projectId: string;
  name: string;
  status: ProjectStatus;
  notes: string;
  // Spec 79 — all optional; empty string = "leave unchanged" for date/lead/
  // type/budget (RPC COALESCE-preserves), "" clears site_address text.
  siteAddress: string;
  startDate: string; // YYYY-MM-DD or ""
  plannedCompletionDate: string; // YYYY-MM-DD or ""
  projectType: string; // enum value or ""
  projectLeadId: string; // uuid or ""
  budgetAmount: string; // numeric string or ""
  clientId: string; // uuid or "" (— clears the client via set_project_client)
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

  const siteResult = validateSiteAddress(input.siteAddress);
  if (!siteResult.ok) return { ok: false, error: siteResult.error };

  const budgetResult = validateBudgetAmount(input.budgetAmount);
  if (!budgetResult.ok) return { ok: false, error: budgetResult.error };

  const startDate = input.startDate.trim() || null;
  const completionDate = input.plannedCompletionDate.trim() || null;
  const datesResult = validateProjectDates(startDate, completionDate);
  if (!datesResult.ok) return { ok: false, error: datesResult.error };

  const projectType = input.projectType.trim();
  if (projectType !== "" && !isValidProjectType(projectType)) {
    return { ok: false, error: "ประเภทโครงการไม่ถูกต้อง" };
  }
  const leadId = input.projectLeadId.trim();
  if (leadId !== "" && !isValidUuid(leadId)) {
    return { ok: false, error: "ผู้รับผิดชอบไม่ถูกต้อง" };
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
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: PM_ONLY_ERROR };
  }

  const rpcArgs: Database["public"]["Functions"]["update_project_settings"]["Args"] = {
    p_project_id: input.projectId,
    p_name: nameResult.name,
    p_status: input.status,
    // "" clears via the RPC's nullif; null would preserve — match spec-72 notes.
    p_notes: notesResult.value ?? "",
    p_site_address: siteResult.value ?? "",
  };
  // Optional args are OMITTED when unset (exactOptionalPropertyTypes): an absent
  // key uses the SQL default null = COALESCE-preserve (cannot be cleared via the
  // form once set; recorded seam); a present value sets the column.
  if (completionDate !== null) rpcArgs.p_planned_completion_date = completionDate;
  if (budgetResult.value !== null) rpcArgs.p_budget_amount_thb = budgetResult.value;
  if (startDate !== null) rpcArgs.p_start_date = startDate;
  if (leadId !== "") rpcArgs.p_project_lead_id = leadId;
  if (projectType !== "") rpcArgs.p_project_type = projectType as ProjectType;

  const { data: updated, error: rpcError } = await supabase.rpc("update_project_settings", rpcArgs);
  if (rpcError) {
    console.error("[updateProjectSettings] RPC failed", {
      projectId: input.projectId,
      error: rpcError.message,
    });
    // The RPC raises 22023 on a past completion date / negative budget /
    // unknown lead — surface a readable hint rather than the generic message.
    if (rpcError.code === "22023") {
      return {
        ok: false,
        error: "ข้อมูลไม่ถูกต้อง (วันเสร็จเป็นอดีต งบติดลบ หรือผู้รับผิดชอบไม่พบ)",
      };
    }
    return { ok: false, error: "บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (updated !== true) return { ok: false, error: "ไม่พบโครงการ" };

  // Client FK rides a dedicated RPC; "" → null clears it. The SQL param accepts
  // NULL, but typegen omits arg-nullability (types it string), so cast — PostgREST
  // sends JSON null through.
  const { data: clientOk, error: clientErr } = await supabase.rpc("set_project_client", {
    p_project_id: input.projectId,
    p_client_id: (clientId === "" ? null : clientId) as string,
  });
  if (clientErr) {
    console.error("[updateProjectSettings] set_project_client failed", {
      projectId: input.projectId,
      error: clientErr.message,
    });
    return { ok: false, error: "บันทึกลูกค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (clientOk !== true) return { ok: false, error: "ไม่พบลูกค้าที่เลือก" };

  revalidatePath("/sa");
  revalidatePath("/pm/projects");
  revalidatePath(projectHref(input.projectId));
  revalidatePath(projectSettingsHref(input.projectId));
  return { ok: true };
}

// Inline "add client" — mirrors the contractor/supplier master create path.
export interface CreateClientInput {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  mailingAddress: string;
}

export type CreateClientResult = { ok: true; id: string } | { ok: false; error: string };

export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, error: "กรุณาใส่ชื่อลูกค้า" };
  if (name.length > CLIENT_NAME_MAX) {
    return { ok: false, error: `ชื่อลูกค้าต้องไม่เกิน ${CLIENT_NAME_MAX} ตัวอักษร` };
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

  const norm = (s: string) => {
    const t = s.trim();
    return t.length === 0 ? null : t;
  };

  const { data, error } = await supabase
    .from("clients")
    .insert({
      name,
      contact_person: norm(input.contactPerson),
      phone: norm(input.phone),
      email: norm(input.email),
      mailing_address: norm(input.mailingAddress),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[createClient] insert failed", { error: error?.message });
    return { ok: false, error: "เพิ่มลูกค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  return { ok: true, id: data.id };
}

// Spec 80 — project team. PM/super add/remove members directly under their
// authenticated session (RLS grants + policies are the load-bearing gate).
export type MemberResult = { ok: true } | { ok: false; error: string };

async function gateProjectMember(projectId: string, userId: string) {
  if (!isValidUuid(projectId) || !isValidUuid(userId)) {
    return { ok: false as const, error: "ข้อมูลสมาชิกไม่ถูกต้อง" };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false as const, error: NOT_SIGNED_IN };
  const { data: userRow } = await auth.supabase
    .from("users")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false as const, error: PM_ONLY_ERROR };
  }
  return { ok: true as const, auth };
}

export async function addProjectMember(projectId: string, userId: string): Promise<MemberResult> {
  const gate = await gateProjectMember(projectId, userId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase, user } = gate.auth;

  const { error } = await supabase
    .from("project_members")
    .insert({ project_id: projectId, user_id: userId, added_by: user.id });
  // 23505 = already a member → treat as success (idempotent add).
  if (error && error.code !== "23505") {
    console.error("[addProjectMember] insert failed", { projectId, error: error.message });
    return { ok: false, error: "เพิ่มสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  revalidatePath(projectHref(projectId));
  revalidatePath(projectSettingsHref(projectId));
  return { ok: true };
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<MemberResult> {
  const gate = await gateProjectMember(projectId, userId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate.auth;

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) {
    console.error("[removeProjectMember] delete failed", { projectId, error: error.message });
    return { ok: false, error: "ลบสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  revalidatePath(projectHref(projectId));
  revalidatePath(projectSettingsHref(projectId));
  return { ok: true };
}
