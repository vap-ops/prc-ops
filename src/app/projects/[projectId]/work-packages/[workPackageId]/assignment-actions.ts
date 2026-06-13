"use server";

// WP contractor-owner actions (spec 31 / ADR 0033 — replaced the spec-28
// user-owner actions). Authorization is the DB's: contractors INSERT is
// PM/super with created_by pinned; contractor_id flows through the
// existing PM/super work_packages UPDATE policy (0 rows for anyone
// else). Actions validate shape and relay.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { workPackageHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type AssignmentResult = { ok: true } | { ok: false; error: string };
export type CreateContractorResult = { ok: true; id: string } | { ok: false; error: string };

function wpPath(projectId: string, workPackageId: string): string {
  return workPackageHref(projectId, workPackageId);
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

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

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

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  // RPC, not a direct UPDATE: site admins have no work_packages UPDATE
  // policy, and the SECURITY DEFINER function writes contractor_id ONLY
  // (spec-31 amendment — field staff assign crews too).
  // Omitting p_contractor_id uses the SQL DEFAULT NULL — that's how an
  // assignment is cleared (typegen marks default args optional).
  const { data, error } = await supabase.rpc(
    "set_work_package_contractor",
    input.contractorId === null
      ? { p_work_package_id: input.workPackageId }
      : { p_work_package_id: input.workPackageId, p_contractor_id: input.contractorId },
  );
  if (error || data !== true) {
    return { ok: false, error: "บันทึกผู้รับเหมาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(wpPath(input.projectId, input.workPackageId));
  return { ok: true };
}
