"use server";

// Server actions for the SA upload UI write path (spec 03 PR 2).
//
// All photo_logs writes go through these actions — the file bytes
// themselves are uploaded direct from the browser to Storage under the
// user's session; only metadata reaches the server.
//
// addPhoto:
//   - Validates inputs (uuid, ext, phase, WP read by user under RLS).
//   - INSERTs the photo_logs row under the user's session (SSR client,
//     photo_logs RLS admits SA/PM/super_admin).
//   - Then conditionally transitions the parent WP to
//     `pending_approval` per spec-03 decision 14 — using the admin
//     client because work_packages UPDATE RLS does not admit
//     site_admin (decision 15 option (a)). The UPDATE is doubly
//     guarded: the JS condition (shouldTransitionToPendingApproval) +
//     a SQL `where status in (...)` clause so the rule is enforced in
//     two independent layers and the update can never regress an
//     already-pending / already-complete WP.
//
// removePhoto:
//   - Validates that the target is a current, real (non-tombstone,
//     non-superseded) photo on the named WP under RLS.
//   - INSERTs a well-formed tombstone (per ADR 0015) under the user's
//     session. The Storage object is intentionally LEFT in place
//     (v2 orphan cleanup); removal NEVER regresses WP status.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import {
  buildPhotoStoragePath,
  isValidPhotoExt,
  isValidUuid,
  type PhotoExt,
} from "@/lib/photos/path";
import { buildTombstoneRow } from "@/lib/photos/tombstone";
import {
  shouldTransitionToPendingApproval,
  TRANSITIONABLE_FROM_STATUSES,
  type PhotoPhase,
} from "@/lib/photos/transitions";

const PHOTO_PHASES: ReadonlyArray<PhotoPhase> = ["before", "during", "after"];
function isValidPhase(value: unknown): value is PhotoPhase {
  return typeof value === "string" && (PHOTO_PHASES as readonly string[]).includes(value);
}

export interface AddPhotoInput {
  workPackageId: string;
  phase: PhotoPhase;
  photoId: string;
  ext: PhotoExt;
  capturedAtClient?: string | null;
}

export type AddPhotoResult =
  | { ok: true; photoId: string; transitioned: boolean }
  | { ok: false; error: string };

export async function addPhoto(input: AddPhotoInput): Promise<AddPhotoResult> {
  if (!isValidUuid(input.workPackageId)) return { ok: false, error: "Invalid work package id." };
  if (!isValidUuid(input.photoId)) return { ok: false, error: "Invalid photo id." };
  if (!isValidPhase(input.phase)) return { ok: false, error: "Invalid phase." };
  if (!isValidPhotoExt(input.ext)) return { ok: false, error: "Unsupported image type." };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Look up the WP under the caller's RLS context. If the caller
  // can't read it (wrong role, RLS rejects), the lookup returns null
  // and we refuse without leaking whether the row exists.
  const { data: wp, error: wpError } = await supabase
    .from("work_packages")
    .select("id, project_id, status")
    .eq("id", input.workPackageId)
    .maybeSingle();
  if (wpError || !wp) return { ok: false, error: "Work package not found." };

  // Server reconstructs the canonical storage path from validated
  // inputs and the WP's own project_id. The client never sends a
  // path; if its uploaded object key disagrees with this string,
  // the row will reference an orphan (acceptable per spec) but the
  // row insert itself is trustworthy.
  const storagePath = buildPhotoStoragePath(wp.project_id, wp.id, input.photoId, input.ext);

  const { error: insertError } = await supabase.from("photo_logs").insert({
    id: input.photoId,
    work_package_id: wp.id,
    phase: input.phase,
    storage_path: storagePath,
    uploaded_by: user.id,
    captured_at_client: input.capturedAtClient ?? null,
  });
  if (insertError) {
    return { ok: false, error: "Couldn't record the photo. Please try again." };
  }

  let transitioned = false;
  if (shouldTransitionToPendingApproval(input.phase, wp.status)) {
    // Option (a): admin-client UPDATE, narrow to status only, with a
    // SQL guard so the rule can't be widened by a future caller. The
    // .in("status", TRANSITIONABLE_FROM_STATUSES) clause is the
    // load-bearing safety net — even if the JS predicate above
    // changes, this UPDATE will still no-op against pending_approval
    // and complete WPs.
    const admin = createAdminClient();
    const { data: updated, error: updateError } = await admin
      .from("work_packages")
      .update({ status: "pending_approval" })
      .eq("id", wp.id)
      .in("status", TRANSITIONABLE_FROM_STATUSES as unknown as string[])
      .select("id");
    // We deliberately don't roll back the photo_logs insert if the
    // status update fails — the photo is real and recorded; the
    // status transition is recoverable on the next After upload (or
    // a future PM action). Logged for the operator.
    if (updateError) {
      console.error("[addPhoto] WP status transition failed", {
        workPackageId: wp.id,
        error: updateError.message,
      });
    } else if (updated && updated.length > 0) {
      transitioned = true;
    }
  }

  revalidatePath(`/sa/projects/${wp.project_id}/work-packages/${wp.id}`);
  return { ok: true, photoId: input.photoId, transitioned };
}

export interface RemovePhotoInput {
  photoLogId: string;
}

export type RemovePhotoResult = { ok: true } | { ok: false; error: string };

export async function removePhoto(input: RemovePhotoInput): Promise<RemovePhotoResult> {
  if (!isValidUuid(input.photoLogId)) return { ok: false, error: "Invalid photo id." };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Validate the target is a real photo on a WP the caller can read.
  // RLS gates this select; if the caller can't see the row, we
  // refuse. We then check that storage_path is set (not already a
  // tombstone) — guards against double-remove from a stale UI.
  const { data: target, error: targetError } = await supabase
    .from("photo_logs")
    .select("id, work_package_id, phase, storage_path")
    .eq("id", input.photoLogId)
    .maybeSingle();
  if (targetError || !target) return { ok: false, error: "Photo not found." };
  if (target.storage_path === null) {
    return { ok: false, error: "Photo already removed." };
  }

  // Anti-join guard: refuse if some other row already supersedes
  // this one (defends against double-remove racing the page refresh).
  const { data: supersedingRows, error: supersededError } = await supabase
    .from("photo_logs")
    .select("id")
    .eq("superseded_by", target.id)
    .limit(1);
  if (supersededError) return { ok: false, error: "Couldn't verify photo state." };
  if (supersedingRows && supersedingRows.length > 0) {
    return { ok: false, error: "Photo already removed." };
  }

  const { error: tombstoneError } = await supabase.from("photo_logs").insert(
    buildTombstoneRow({
      workPackageId: target.work_package_id,
      phase: target.phase,
      targetPhotoId: target.id,
      uploadedBy: user.id,
    }),
  );
  if (tombstoneError) {
    return { ok: false, error: "Couldn't remove the photo. Please try again." };
  }

  // Look up the WP's project_id only for revalidatePath — the
  // tombstone insert itself doesn't need it.
  const { data: wp } = await supabase
    .from("work_packages")
    .select("project_id")
    .eq("id", target.work_package_id)
    .maybeSingle();
  if (wp) {
    revalidatePath(`/sa/projects/${wp.project_id}/work-packages/${target.work_package_id}`);
  }

  return { ok: true };
}
