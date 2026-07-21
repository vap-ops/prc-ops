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
//     already-pending / already-complete WP. Spec 52 adds the same
//     shape for the first During photo: not_started → in_progress
//     (never out of on_hold — that release is the PM's toggle).
//
// removePhoto:
//   - Validates that the target is a current, real (non-tombstone,
//     non-superseded) photo on the named WP under RLS.
//   - INSERTs a well-formed tombstone (per ADR 0015) under the user's
//     session. The Storage object is intentionally LEFT in place
//     (v2 orphan cleanup); removal NEVER regresses WP status.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN, requireActionRole } from "@/lib/auth/action-gate";
import { isManagerRole, SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { projectHref, workPackageHref } from "@/lib/nav/project-paths";
import {
  buildPhotoStoragePath,
  isValidPhotoExt,
  isValidUuid,
  type PhotoExt,
} from "@/lib/photos/path";
import { buildTombstoneRow } from "@/lib/photos/tombstone";
import { isPhotoWpDeletable, PHOTO_DELETE_LOCKED_ERROR } from "@/lib/photos/deletable";
import { PAIRING_REJECTED_MESSAGE } from "@/lib/photos/upload-queue";
import { photoReworkRoundFor } from "@/lib/photos/rework-round";
import type { ReworkSource } from "@/lib/db/enums";
import {
  shouldTransitionToInProgress,
  submitGateReason,
  type PhotoPhase,
} from "@/lib/photos/transitions";
import { getCurrentPhotosForWorkPackage } from "@/lib/photos/current-photos";

// Spec 248: 'defect' is insertable ONLY through the scoped branch inside
// addPhoto (filing roles + WP in rework) — listing it here just admits it to
// phase validation; a runtime list, typecheck never checks it.
const PHOTO_PHASES: ReadonlyArray<PhotoPhase> = [
  "before",
  "during",
  "after",
  "after_fix",
  "defect",
];
function isValidPhase(value: unknown): value is PhotoPhase {
  return typeof value === "string" && (PHOTO_PHASES as readonly string[]).includes(value);
}

export interface AddPhotoInput {
  workPackageId: string;
  phase: PhotoPhase;
  photoId: string;
  ext: PhotoExt;
  capturedAtClient?: string | null;
  /** Spec 248 U3 — the defect photo this after_fix row ANSWERS (same-angle
   *  re-shoot). Only meaningful on phase 'after_fix'; the U1 DB trigger
   *  validates the target (same WP, same round, current defect photo). */
  answersPhotoId?: string | null;
}

export type AddPhotoResult =
  | { ok: true; photoId: string; transitioned: boolean }
  | { ok: false; error: string };

export async function addPhoto(input: AddPhotoInput): Promise<AddPhotoResult> {
  if (!isValidUuid(input.workPackageId)) return { ok: false, error: "รหัสรายการงานไม่ถูกต้อง" };
  if (!isValidUuid(input.photoId)) return { ok: false, error: "รหัสรูปไม่ถูกต้อง" };
  if (!isValidPhase(input.phase)) return { ok: false, error: "ช่วงงานไม่ถูกต้อง" };
  if (!isValidPhotoExt(input.ext)) return { ok: false, error: "ไม่รองรับไฟล์รูปแบบนี้" };
  const answersPhotoId = input.answersPhotoId ?? null;
  if (answersPhotoId !== null) {
    // Friendly early checks; the DB trigger re-validates the target itself.
    if (!isValidUuid(answersPhotoId)) return { ok: false, error: "รหัสรูปข้อบกพร่องไม่ถูกต้อง" };
    if (input.phase !== "after_fix") {
      return { ok: false, error: "จับคู่รูปได้เฉพาะรูปหลังแก้ไข" };
    }
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  // Look up the WP under the caller's RLS context. If the caller
  // can't read it (wrong role, RLS rejects), the lookup returns null
  // and we refuse without leaking whether the row exists.
  const { data: wp, error: wpError } = await supabase
    .from("work_packages")
    .select("id, project_id, status, rework_round")
    .eq("id", input.workPackageId)
    .maybeSingle();
  if (wpError || !wp) return { ok: false, error: "ไม่พบรายการงาน" };

  // Spec 248: a defect photo is the FILING roles' evidence (PM/PD/super —
  // isManagerRole) and only lands while the WP is actually in rework, i.e.
  // right after the reopen RPC bumped the round. No SA-side defect inserts,
  // no closed-round pollution. The RLS uploaded_by pin + the DB guard
  // trigger gate again underneath; this is the friendly early check.
  if (input.phase === "defect") {
    const { data: self } = await supabase.from("users").select("role").eq("id", user.id).single();
    // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is gated here too.
    const effectiveRole = await applyAssumedRole(self?.role);
    if (!effectiveRole || !isManagerRole(effectiveRole)) {
      return { ok: false, error: "เฉพาะผู้จัดการที่รายงานข้อบกพร่องจึงแนบรูปได้" };
    }
    if (wp.status !== "rework") {
      return { ok: false, error: "แนบรูปข้อบกพร่องได้เฉพาะงานที่เปิดแก้ไขอยู่" };
    }
  }

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
    // Spec 216: an after_fix (หลังแก้ไข) photo belongs to the WP's current rework
    // cycle; every other phase stays round 0.
    rework_round: photoReworkRoundFor(input.phase, wp.rework_round),
    // Spec 248 U3 — the pairing; the U1 trigger validates the target.
    answers_photo_id: answersPhotoId,
  });
  if (insertError) {
    // Spec 35 / ADR 0039: idempotent replay — the offline queue may
    // re-run a step whose first attempt actually landed. A unique
    // violation alone is NOT enough (photo ids are readable role-wide,
    // so a forged replay could claim a foreign row and ride the
    // transition below): the existing row must match the FULL replayed
    // identity — same WP, same phase, same canonical path. Nothing is
    // ever UPDATEd; the transition guard below re-checks WP status.
    //
    // Spec 248 U3: 23514 (the pairing guard trigger) ALSO reaches the
    // identity probe — a BEFORE INSERT trigger fires ahead of the unique
    // check, so a replay of an already-landed paired row raises 23514, not
    // 23505. Probe first; only a genuinely-unlanded 23514 is terminal
    // (target removed / round closed — retrying can never fix it).
    if (insertError.code !== "23505" && insertError.code !== "23514") {
      return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    // Spec 248 U3: the pairing is part of the replayed identity — a replay
    // must not "succeed" against a row whose answers_photo_id differs (a
    // forged replay could otherwise claim an unpaired row as a paired one).
    let identity = supabase
      .from("photo_logs")
      .select("id")
      .eq("id", input.photoId)
      .eq("work_package_id", wp.id)
      .eq("phase", input.phase)
      .eq("storage_path", storagePath);
    identity =
      answersPhotoId === null
        ? identity.is("answers_photo_id", null)
        : identity.eq("answers_photo_id", answersPhotoId);
    const { data: existing } = await identity.maybeSingle();
    if (!existing) {
      if (insertError.code === "23514") {
        // Terminal: the pairing target is gone or the round moved on. The
        // shared message string lets the queue classify this as permanent.
        return { ok: false, error: PAIRING_REJECTED_MESSAGE };
      }
      return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
  }

  // FB2 (b9e942f0): an "after" photo no longer auto-flips the WP to
  // pending_approval. That sent a partly-done WP to review on its FIRST after
  // photo; submission is now an explicit SA act (submitWorkPackageForApproval —
  // the "ส่งงานเข้าตรวจ" button), reversing the spec-03 decision-14 auto-flip.
  // The During → in_progress flip below is unaffected (operator kept it).
  let transitioned = false;

  // Spec 52: first During photo flips not_started → in_progress. Same
  // option-(a) shape as the After branch above; the two predicates are
  // mutually exclusive by phase. The .eq("status", "not_started") SQL
  // guard is the second layer — it can never release on_hold or regress
  // a pending/complete WP, even if the JS predicate changes.
  if (shouldTransitionToInProgress(input.phase, wp.status)) {
    const admin = createAdminClient();
    const { data: updated, error: updateError } = await admin
      .from("work_packages")
      .update({ status: "in_progress" })
      .eq("id", wp.id)
      .eq("status", "not_started")
      .select("id");
    // Same non-rollback posture as the After branch: the photo is real
    // and recorded; the status flip is recoverable on the next During
    // upload (or the PM hold toggle).
    if (updateError) {
      console.error("[addPhoto] WP in_progress transition failed", {
        workPackageId: wp.id,
        error: updateError.message,
      });
    } else if (updated && updated.length > 0) {
      transitioned = true;
    }
  }

  revalidatePath(workPackageHref(wp.project_id, wp.id));
  return { ok: true, photoId: input.photoId, transitioned };
}

// FB2 (b9e942f0) — explicit "ส่งงานเข้าตรวจ": the SA submits a finished WP for
// approval. Replaces the addPhoto auto-flip (above) so a partly-done WP is no
// longer pushed to review on its first "after" photo.
//
// Spec 337 U1 — the transition runs through submit_work_package_for_approval,
// a SECURITY DEFINER RPC, on the CALLER's session. `authenticated` holds no
// UPDATE grant on work_packages.status (revoked at ERD-audit M2), and the old
// admin-client escalation made every transition ANONYMOUS: the service-role
// session has no JWT `sub`, so wp_transition_audit stored actor_id NULL for
// 100% of rows (F1). The RPC re-checks role (SITE_STAFF_ROLES), membership
// (can_see_wp) and the allowed-from status set; the PHOTO gate below stays here
// because it needs the RLS-scoped current-photos anti-join read.
export interface SubmitForApprovalInput {
  projectId: string;
  workPackageId: string;
}

export type SubmitForApprovalResult = { ok: true } | { ok: false; error: string };

export async function submitWorkPackageForApproval(
  input: SubmitForApprovalInput,
): Promise<SubmitForApprovalResult> {
  if (!isValidUuid(input.workPackageId)) return { ok: false, error: "รหัสรายการงานไม่ถูกต้อง" };

  // Site staff only — the field-capture population that drove the old auto-flip.
  // Procurement is a read-only WP viewer (isReadOnlyWpViewer) and must not submit.
  const gate = await requireActionRole(SITE_STAFF_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };
  const { supabase } = gate.auth;

  // RLS-scoped read = the membership/visibility gate. A caller who can't see the
  // WP (wrong role / not a project member) gets null and is refused, without
  // leaking whether the row exists.
  const { data: wp, error: wpError } = await supabase
    .from("work_packages")
    .select("id, project_id, status, rework_round")
    .eq("id", input.workPackageId)
    .maybeSingle();
  if (wpError || !wp) return { ok: false, error: "ไม่พบรายการงาน" };

  // Spec 247 + 248 U4 — the photo gate: floor (current completion evidence)
  // AND, in rework, pairing (every current defect photo of the round
  // answered). Same RLS-scoped current-state read the page uses (anti-join +
  // tombstone, ADR 0009/0015); the UI's disabled button is convenience, this
  // check is the enforcement.
  const currentPhotos = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const gateReason = submitGateReason(wp.status, currentPhotos, wp.rework_round);
  if (gateReason !== null) {
    return { ok: false, error: gateReason };
  }

  const { error: rpcError } = await supabase.rpc("submit_work_package_for_approval", {
    p_wp: wp.id,
  });
  if (rpcError) {
    // 22023 = the RPC's status guard: already pending_approval / complete, or a
    // colleague moved it while this page was open. Tell the SA plainly rather
    // than silently "succeeding". 42501 = role/membership, which the gates above
    // already cover, so reaching it means the session desynced — answer with the
    // same RLS-shaped refusal the WP read gives.
    return {
      ok: false,
      error:
        rpcError.code === "22023"
          ? "งานนี้ส่งตรวจแล้ว หรือยังไม่พร้อมส่ง"
          : rpcError.code === "42501"
            ? "ไม่พบรายการงาน"
            : "ส่งงานเข้าตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    };
  }

  revalidatePath(workPackageHref(wp.project_id, wp.id));
  return { ok: true };
}

export interface RemovePhotoInput {
  photoLogId: string;
}

export type RemovePhotoResult = { ok: true } | { ok: false; error: string };

export async function removePhoto(input: RemovePhotoInput): Promise<RemovePhotoResult> {
  if (!isValidUuid(input.photoLogId)) return { ok: false, error: "รหัสรูปไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  // Validate the target is a real photo on a WP the caller can read.
  // RLS gates this select; if the caller can't see the row, we
  // refuse. We then check that storage_path is set (not already a
  // tombstone) — guards against double-remove from a stale UI.
  const { data: target, error: targetError } = await supabase
    .from("photo_logs")
    .select("id, work_package_id, phase, storage_path, rework_round")
    .eq("id", input.photoLogId)
    .maybeSingle();
  if (targetError || !target) return { ok: false, error: "ไม่พบรูป" };
  if (target.storage_path === null) {
    return { ok: false, error: "รูปนี้ถูกลบไปแล้ว" };
  }

  // Spec 291 U1: a progress photo is per-WP approval evidence — deletion is
  // locked once the WP is submitted for approval or complete, so a submitted
  // set cannot be altered. Read the WP status first and refuse with a friendly
  // message; the photo_logs WITH CHECK (migration 075630) is the RLS backstop.
  // project_id doubles as the revalidatePath key below — one WP read, not two.
  const { data: wp } = await supabase
    .from("work_packages")
    .select("project_id, status")
    .eq("id", target.work_package_id)
    .maybeSingle();
  if (!wp) return { ok: false, error: "ไม่พบงาน" };
  if (!isPhotoWpDeletable(wp.status)) {
    return { ok: false, error: PHOTO_DELETE_LOCKED_ERROR };
  }

  // Anti-join guard: refuse if some other row already supersedes
  // this one (defends against double-remove racing the page refresh).
  const { data: supersedingRows, error: supersededError } = await supabase
    .from("photo_logs")
    .select("id")
    .eq("superseded_by", target.id)
    .limit(1);
  if (supersededError) return { ok: false, error: "ตรวจสอบสถานะรูปไม่สำเร็จ" };
  if (supersedingRows && supersedingRows.length > 0) {
    return { ok: false, error: "รูปนี้ถูกลบไปแล้ว" };
  }

  const { error: tombstoneError } = await supabase.from("photo_logs").insert(
    buildTombstoneRow({
      workPackageId: target.work_package_id,
      phase: target.phase,
      targetPhotoId: target.id,
      uploadedBy: user.id,
      // Spec 216: the removal stays in the same rework cycle as its target.
      reworkRound: target.rework_round,
    }),
  );
  if (tombstoneError) {
    return { ok: false, error: "ลบรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(workPackageHref(wp.project_id, target.work_package_id));
  return { ok: true };
}

// Spec 144 U2 — report a defect on a complete WP, reopening it to 'rework'.
// The SECURITY DEFINER reopen_work_package_for_defect RPC carries the role +
// membership + complete-only gates; this maps the result to clean Thai errors.
export interface ReportDefectInput {
  projectId: string;
  workPackageId: string;
  reason: string;
  // Spec 217: who called this rework — internal QA/SA (ตรวจภายใน) or the client
  // (ลูกค้าแจ้ง).
  source: ReworkSource;
}
export type ReportDefectResult = { ok: true } | { ok: false; error: string };

export async function reportDefect(input: ReportDefectInput): Promise<ReportDefectResult> {
  if (!isValidUuid(input.workPackageId)) return { ok: false, error: "รหัสงานไม่ถูกต้อง" };
  const reason = input.reason.trim();
  if (reason === "") return { ok: false, error: "กรุณาระบุรายละเอียดข้อบกพร่อง" };
  if (reason.length > 1000) return { ok: false, error: "รายละเอียดต้องไม่เกิน 1000 ตัวอักษร" };
  if (input.source !== "internal" && input.source !== "client") {
    return { ok: false, error: "ระบุที่มาของข้อบกพร่องไม่ถูกต้อง" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("reopen_work_package_for_defect", {
    p_wp: input.workPackageId,
    p_reason: reason,
    p_source: input.source,
  });
  if (error) {
    console.error("[reportDefect] RPC failed", { wp: input.workPackageId, error: error.message });
    if (error.code === "42501") {
      return { ok: false, error: "คุณไม่มีสิทธิ์เปิดงานนี้ใหม่ (ต้องเป็นทีมงานของโครงการ)" };
    }
    if (error.code === "22023") {
      return { ok: false, error: "เปิดงานใหม่ได้เฉพาะงานที่เสร็จแล้วเท่านั้น" };
    }
    return { ok: false, error: "เปิดงานใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (data !== true) return { ok: false, error: "เปิดงานใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  revalidatePath(projectHref(input.projectId));
  return { ok: true };
}
