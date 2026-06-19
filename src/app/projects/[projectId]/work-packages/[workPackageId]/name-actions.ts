"use server";

// Spec 156 / ADR 0059 — rename a work package. PM/super/director edit a WP's
// name; authorization is the DB's (set_work_package_name is a SECURITY DEFINER
// RPC, role- + membership-gated). This action validates shape + relays. code
// stays immutable (ADR 0059 §2).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { workPackageHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type SetNameResult = { ok: true } | { ok: false; error: string };

const FAILED = "บันทึกชื่องานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setWorkPackageName(input: {
  projectId: string;
  workPackageId: string;
  name: string;
}): Promise<SetNameResult> {
  const name = input.name.trim();
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    name === "" ||
    name.length > 200
  ) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("set_work_package_name", {
    p_work_package_id: input.workPackageId,
    p_name: name,
  });
  if (error || data !== true) {
    return { ok: false, error: FAILED };
  }

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}
