"use server";

// Spec 389 U5 — star / un-star a photo as a reference example (ตัวอย่างงาน).
// The write goes through the SECURITY DEFINER star_reference_photo /
// unstar_reference_photo RPCs (PD-tier gate, superseded/unmapped refusals live
// in the DB — wp_catalog_reference_photos has no write grant). requireRole
// here is defense-in-depth + a fast bounce.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC_ERROR = "บันทึกดาวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const FORBIDDEN_ERROR = "เฉพาะผู้อำนวยการโครงการเท่านั้นที่ปักดาวได้";
const INVALID_ERROR = "ปักดาวไม่ได้: รูปถูกแทนที่แล้ว หรืองานยังไม่ได้จับคู่กับแคตตาล็อก";

export interface StarResult {
  ok: boolean;
  error?: string;
}

async function callStarRpc(
  projectId: string,
  workPackageId: string,
  photoId: string,
  star: boolean,
): Promise<StarResult> {
  await requireRole(["project_director", "super_admin"]);

  if (![projectId, workPackageId, photoId].every((v) => UUID_REGEX.test(v))) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = star
    ? await supabase.rpc("star_reference_photo", { p_photo_log_id: photoId })
    : await supabase.rpc("unstar_reference_photo", { p_photo_log_id: photoId });

  if (error) {
    console.error("[star-actions] rpc failed", { photoId, star, code: error.code });
    // permanent refusals get honest copy — no "retry" on a call that cannot succeed
    if (error.code === "42501") return { ok: false, error: FORBIDDEN_ERROR };
    if (error.code === "22023") return { ok: false, error: INVALID_ERROR };
    return { ok: false, error: GENERIC_ERROR };
  }

  // the review page carries the toggle; the WP detail carries the ตัวอย่างงาน
  // section reading the same star set — refresh both
  revalidatePath(`/review/work-packages/${workPackageId}`);
  revalidatePath(`/projects/${projectId}/work-packages/${workPackageId}`);
  return { ok: true };
}

export async function starReferencePhoto(
  projectId: string,
  workPackageId: string,
  photoId: string,
): Promise<StarResult> {
  return callStarRpc(projectId, workPackageId, photoId, true);
}

export async function unstarReferencePhoto(
  projectId: string,
  workPackageId: string,
  photoId: string,
): Promise<StarResult> {
  return callStarRpc(projectId, workPackageId, photoId, false);
}
