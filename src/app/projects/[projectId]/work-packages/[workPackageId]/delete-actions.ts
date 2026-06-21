"use server";

// Spec 157 / ADR 0059 — delete a work package (Tier 1: empty-only). PM/super/
// director hard-delete a WP that has no captured history; authorization + the
// empty-guard are the DB's (delete_work_package is a SECURITY DEFINER RPC, role-
// + membership-gated, refusing with P0001 when any child row exists). This action
// validates shape + relays, and maps P0001 to the "cancel instead" message.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { projectHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type DeleteWorkPackageResult = { ok: true } | { ok: false; error: string };

const FAILED = "ลบงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
// P0001 = the empty-guard (the WP has photos / labor / requests / members / deps).
const HAS_HISTORY = "ลบไม่ได้ — งานนี้มีรูป ทีมงาน หรือคำขอซื้อแล้ว (การยกเลิกงานจะมาเร็วๆนี้)";

export async function deleteWorkPackage(input: {
  projectId: string;
  workPackageId: string;
}): Promise<DeleteWorkPackageResult> {
  if (!UUID_REGEX.test(input.workPackageId) || !UUID_REGEX.test(input.projectId)) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("delete_work_package", {
    p_work_package_id: input.workPackageId,
  });
  if (error) {
    if (error.code === "P0001") return { ok: false, error: HAS_HISTORY };
    return { ok: false, error: FAILED };
  }
  if (data !== true) return { ok: false, error: FAILED };

  revalidatePath(projectHref(input.projectId));
  return { ok: true };
}
