"use server";

// Spec 226 / 207 U3c — bind a work package to exactly one of its project's
// work-categories (หมวดงาน), or clear it. PM/super/director only; authorization
// is the DB's (set_work_package_category is a SECURITY DEFINER RPC, role- +
// membership-gated, shipped in 20260813003400). This action validates shape +
// relays. categoryId null = uncategorise. The locked one-category-per-WP rule
// (a single FK, never a join) is enforced by the column itself.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { workPackageHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type SetCategoryResult = { ok: true } | { ok: false; error: string };

const FAILED = "บันทึกหมวดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setWorkPackageCategory(input: {
  projectId: string;
  workPackageId: string;
  categoryId: string | null;
}): Promise<SetCategoryResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    (input.categoryId !== null && !UUID_REGEX.test(input.categoryId))
  ) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  // set_work_package_category(p_work_package_id, p_category_id) — p_category_id
  // has no SQL default, so typegen marks it a non-null string; but the RPC
  // accepts NULL at runtime (= uncategorise) and is always passed. Cast to send
  // null through the generated Args.
  const { data, error } = await supabase.rpc("set_work_package_category", {
    p_work_package_id: input.workPackageId,
    p_category_id: input.categoryId as string,
  });
  if (error || data !== true) {
    return { ok: false, error: FAILED };
  }

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}
