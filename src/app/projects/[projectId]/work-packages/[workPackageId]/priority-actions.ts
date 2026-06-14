"use server";

// WP priority action (spec 91 follow-up). PM/super set a work package's
// manual urgency flag — the worklist alignment lever (ด่วน tag + ต้องทำ sort).
// Authorization is the DB's: set_work_package_priority is a SECURITY DEFINER
// RPC that permits only project_manager / super_admin (site_admin → 42501),
// mirroring set_work_package_contractor. This action validates shape + relays.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { workPackageHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";
import type { WpPriority } from "@/lib/work-packages/action-bands";

export type SetPriorityResult = { ok: true } | { ok: false; error: string };

const PRIORITIES: readonly WpPriority[] = ["normal", "urgent", "critical"];
const FAILED = "บันทึกความสำคัญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setWorkPackagePriority(input: {
  projectId: string;
  workPackageId: string;
  priority: WpPriority;
}): Promise<SetPriorityResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    !PRIORITIES.includes(input.priority)
  ) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("set_work_package_priority", {
    p_work_package_id: input.workPackageId,
    p_priority: input.priority,
  });
  if (error || data !== true) {
    return { ok: false, error: FAILED };
  }

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}
