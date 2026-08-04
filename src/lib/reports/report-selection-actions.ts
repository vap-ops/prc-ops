"use server";

// Spec 394 U2 — pick / unpick / arrange the photos that go into a CLIENT
// report. Every write goes through the SECURITY DEFINER RPCs
// (report_selected_photos has no write grant); the gate there is PM_ROLES AND
// can_see_project. requireRole here is defence in depth plus a fast bounce.
//
// ⭐ The gate is deliberately WIDER than starring: a project_manager curates a
// client's report but does NOT declare firm-wide catalogue exemplars (spec D5).
// Do not "harmonise" the two.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC_ERROR = "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const FORBIDDEN_ERROR = "เฉพาะผู้จัดการโครงการเท่านั้นที่เลือกรูปเข้ารายงานได้";
const INVALID_ERROR = "เลือกรูปนี้ไม่ได้: รูปถูกแทนที่หรือถูกลบไปแล้ว";
// The stale-list case is the one a PD actually meets while arranging, and
// unlike the other two it is ACTIONABLE — so it says what to do.
const STALE_LIST_ERROR = "รายการรูปเปลี่ยนไปแล้ว กรุณารีเฟรชหน้านี้แล้วจัดลำดับใหม่";

export interface ReportSelectionResult {
  ok: boolean;
  error?: string;
}

function revalidateSurfaces(workPackageId: string): void {
  // The toggle and the arrange strip live on the review page; the report form
  // reads the same set for its live count.
  revalidatePath(`/review/work-packages/${workPackageId}`);
}

async function callSelectionRpc(
  workPackageId: string,
  photoId: string,
  select: boolean,
): Promise<ReportSelectionResult> {
  await requireRole([...PM_ROLES]);

  if (![workPackageId, photoId].every((v) => UUID_REGEX.test(v))) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = select
    ? await supabase.rpc("select_report_photo", { p_photo_log_id: photoId })
    : await supabase.rpc("unselect_report_photo", { p_photo_log_id: photoId });

  if (error) {
    console.error("[report-selection] rpc failed", { photoId, select, code: error.code });
    // permanent refusals get honest copy — no "retry" on a call that cannot succeed
    if (error.code === "42501") return { ok: false, error: FORBIDDEN_ERROR };
    if (error.code === "22023") return { ok: false, error: INVALID_ERROR };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSurfaces(workPackageId);
  return { ok: true };
}

export async function selectReportPhoto(
  workPackageId: string,
  photoId: string,
): Promise<ReportSelectionResult> {
  return callSelectionRpc(workPackageId, photoId, true);
}

export async function unselectReportPhoto(
  workPackageId: string,
  photoId: string,
): Promise<ReportSelectionResult> {
  return callSelectionRpc(workPackageId, photoId, false);
}

/**
 * Sends the WHOLE work-package list, never a delta: a single statement cannot
 * leave a half-applied order, and the client sends what it displays so the
 * server never reconstructs intent. The RPC refuses (22023) anything that is
 * not exactly the WP's current selected set.
 */
export async function reorderReportPhotos(
  workPackageId: string,
  photoIds: ReadonlyArray<string>,
): Promise<ReportSelectionResult> {
  await requireRole([...PM_ROLES]);

  if (!UUID_REGEX.test(workPackageId) || !photoIds.every((v) => UUID_REGEX.test(v))) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_report_photos", {
    p_work_package_id: workPackageId,
    p_photo_ids: [...photoIds],
  });

  if (error) {
    console.error("[report-selection] reorder failed", { workPackageId, code: error.code });
    if (error.code === "42501") return { ok: false, error: FORBIDDEN_ERROR };
    if (error.code === "22023") return { ok: false, error: STALE_LIST_ERROR };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSurfaces(workPackageId);
  return { ok: true };
}
