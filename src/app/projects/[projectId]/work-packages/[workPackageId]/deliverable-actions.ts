"use server";

// Spec 155 / ADR 0059 — bind a work package to a deliverable (งวดงาน). PM/super/
// director set or clear a WP's deliverable; authorization is the DB's
// (set_work_package_deliverable is a SECURITY DEFINER RPC, role- + membership-
// gated). This action validates shape + relays. deliverableId null = ungroup.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { workPackageHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type SetDeliverableResult = { ok: true } | { ok: false; error: string };

const FAILED = "บันทึกงวดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setWorkPackageDeliverable(input: {
  projectId: string;
  workPackageId: string;
  deliverableId: string | null;
}): Promise<SetDeliverableResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    (input.deliverableId !== null && !UUID_REGEX.test(input.deliverableId))
  ) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  // Omit the arg to ungroup — p_deliverable_id DEFAULTs NULL (typegen marks it
  // optional), the same idiom as set_work_package_schedule's optional dates.
  const args: { p_work_package_id: string; p_deliverable_id?: string } = {
    p_work_package_id: input.workPackageId,
  };
  if (input.deliverableId !== null) args.p_deliverable_id = input.deliverableId;
  const { data, error } = await supabase.rpc("set_work_package_deliverable", args);
  if (error || data !== true) {
    return { ok: false, error: FAILED };
  }

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}
