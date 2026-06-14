"use server";

// WP schedule + dependency actions (spec 92). PM/super set a WP's planned
// window and its finish-to-start predecessors. Authorization is the DB's:
// set_work_package_schedule / add_/remove_work_package_dependency are SECURITY
// DEFINER RPCs that permit only project_manager / super_admin (site_admin →
// 42501) and enforce same-project + no-cycle. These actions validate shape +
// relay. A dependency "this WP depends on X" = X is the predecessor.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { workPackageHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type ScheduleResult = { ok: true } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCHED_FAILED = "บันทึกกำหนดการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const DEP_FAILED = "บันทึกความสัมพันธ์ของงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setWorkPackageSchedule(input: {
  projectId: string;
  workPackageId: string;
  start: string | null;
  end: string | null;
}): Promise<ScheduleResult> {
  if (!UUID_REGEX.test(input.workPackageId) || !UUID_REGEX.test(input.projectId)) {
    return { ok: false, error: SCHED_FAILED };
  }
  if (
    (input.start !== null && !ISO_DATE.test(input.start)) ||
    (input.end !== null && !ISO_DATE.test(input.end))
  ) {
    return { ok: false, error: SCHED_FAILED };
  }
  if (input.start && input.end && input.end < input.start) {
    return { ok: false, error: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // Omit a date arg to clear it — the params DEFAULT NULL (typegen marks them
  // optional), same idiom as set_work_package_contractor.
  const args: { p_work_package_id: string; p_start?: string; p_end?: string } = {
    p_work_package_id: input.workPackageId,
  };
  if (input.start) args.p_start = input.start;
  if (input.end) args.p_end = input.end;
  const { data, error } = await auth.supabase.rpc("set_work_package_schedule", args);
  if (error || data !== true) return { ok: false, error: SCHED_FAILED };

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function addWorkPackageDependency(input: {
  projectId: string;
  workPackageId: string;
  predecessorId: string;
}): Promise<ScheduleResult> {
  if (
    ![input.workPackageId, input.projectId, input.predecessorId].every((v) => UUID_REGEX.test(v))
  ) {
    return { ok: false, error: DEP_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("add_work_package_dependency", {
    p_predecessor: input.predecessorId,
    p_successor: input.workPackageId,
  });
  if (error) return { ok: false, error: DEP_FAILED };
  if (data !== true) {
    return { ok: false, error: "เพิ่มไม่ได้ — อาจทำให้เกิดลำดับวนซ้ำ หรืออยู่คนละโครงการ" };
  }

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function removeWorkPackageDependency(input: {
  projectId: string;
  workPackageId: string;
  predecessorId: string;
}): Promise<ScheduleResult> {
  if (
    ![input.workPackageId, input.projectId, input.predecessorId].every((v) => UUID_REGEX.test(v))
  ) {
    return { ok: false, error: DEP_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("remove_work_package_dependency", {
    p_predecessor: input.predecessorId,
    p_successor: input.workPackageId,
  });
  if (error) return { ok: false, error: DEP_FAILED };

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}
