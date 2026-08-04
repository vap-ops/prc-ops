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

// Spec 391 D5 — HIDE is a different act from un-star, and deliberately a
// separate pair of functions rather than a flag on the ones above.
//
// Un-star removes a choice a human made. Hide suppresses a photo nobody chose:
// since 391 the ตัวอย่างงาน set fills itself, so most of what a PD sees there
// was never starred and there is no star to remove. They also live in different
// tables — `wp_catalog_reference_photos.starred_by` is NOT NULL, so a hide-only
// row has nothing to put there, and `unstar_reference_photo` deletes by photo id
// with no guard, so sharing a table would let un-starring silently delete a hide.
const HIDE_GENERIC_ERROR = "ซ่อนรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const HIDE_INVALID_ERROR = "ซ่อนรูปไม่ได้: ไม่พบรูปนี้";

async function callHideRpc(
  projectId: string,
  workPackageId: string,
  photoId: string,
  hide: boolean,
): Promise<StarResult> {
  await requireRole(["project_director", "super_admin"]);

  if (![projectId, workPackageId, photoId].every((v) => UUID_REGEX.test(v))) {
    return { ok: false, error: HIDE_GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = hide
    ? await supabase.rpc("hide_reference_photo", { p_photo_log_id: photoId })
    : await supabase.rpc("unhide_reference_photo", { p_photo_log_id: photoId });

  if (error) {
    console.error("[star-actions] hide rpc failed", { photoId, hide, code: error.code });
    // Permanent refusals get honest copy — never "try again" on a call that
    // cannot succeed. FORBIDDEN_ERROR is reused verbatim: the DB gate is the
    // same PD-tier one, so the answer to the user is the same fact.
    if (error.code === "42501") return { ok: false, error: FORBIDDEN_ERROR };
    if (error.code === "22023") return { ok: false, error: HIDE_INVALID_ERROR };
    return { ok: false, error: HIDE_GENERIC_ERROR };
  }

  // A hide changes what OTHER work packages of this type show, not this one —
  // the derived arm already excludes the WP being viewed. Revalidating this WP
  // still matters for the toggle's own state; the cross-project effect lands on
  // the next render of those pages, which is the honest bound of a server action.
  revalidatePath(`/review/work-packages/${workPackageId}`);
  revalidatePath(`/projects/${projectId}/work-packages/${workPackageId}`);
  return { ok: true };
}

export async function hideReferencePhoto(
  projectId: string,
  workPackageId: string,
  photoId: string,
): Promise<StarResult> {
  return callHideRpc(projectId, workPackageId, photoId, true);
}

export async function unhideReferencePhoto(
  projectId: string,
  workPackageId: string,
  photoId: string,
): Promise<StarResult> {
  return callHideRpc(projectId, workPackageId, photoId, false);
}
