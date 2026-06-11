"use server";

// WP contractor-owner actions (spec 31 / ADR 0033 — replaced the spec-28
// user-owner actions). Authorization is the DB's: contractors INSERT is
// PM/super with created_by pinned; contractor_id flows through the
// existing PM/super work_packages UPDATE policy (0 rows for anyone
// else). Actions validate shape and relay.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AssignmentResult = { ok: true } | { ok: false; error: string };
export type CreateContractorResult = { ok: true; id: string } | { ok: false; error: string };

function wpPath(projectId: string, workPackageId: string): string {
  return `/sa/projects/${projectId}/work-packages/${workPackageId}`;
}

export async function createContractor(input: {
  name: string;
  phone: string;
}): Promise<CreateContractorResult> {
  const name = input.name.trim();
  const phone = input.phone.trim();
  if (name.length === 0 || name.length > 200) {
    return { ok: false, error: "ชื่อผู้รับเหมาต้องไม่ว่าง" };
  }
  if (phone.length > 50) {
    return { ok: false, error: "บันทึกผู้รับเหมาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data, error } = await supabase
    .from("contractors")
    .insert({ name, phone: phone.length > 0 ? phone : null, created_by: user.id })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "บันทึกผู้รับเหมาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  return { ok: true, id: data.id };
}

export async function setWorkPackageContractor(input: {
  projectId: string;
  workPackageId: string;
  contractorId: string | null;
}): Promise<AssignmentResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    (input.contractorId !== null && !UUID_REGEX.test(input.contractorId))
  ) {
    return { ok: false, error: "บันทึกผู้รับเหมาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data, error } = await supabase
    .from("work_packages")
    .update({ contractor_id: input.contractorId })
    .eq("id", input.workPackageId)
    .select("id");
  if (error || !data || data.length === 0) {
    return { ok: false, error: "บันทึกผู้รับเหมาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(wpPath(input.projectId, input.workPackageId));
  return { ok: true };
}
