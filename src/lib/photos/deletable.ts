// Spec 291 U1 — the photo-delete submit gate, shared by the server action
// (removePhoto) and the UI (capture-sheet). Mirrors the photo_wp_deletable()
// RLS helper (migration 075630, restored by 075831): a progress photo is per-WP
// approval evidence, so a delete (tombstone) is admitted only while the WP is
// still editable and refused once it is submitted for approval or complete.
//
// Amendment (feedback f2096ee4): that freeze also trapped the case the reviewer
// themselves asked for. `needs_revision` ("ให้แก้ไข") asks the uploader to
// re-shoot and LEAVES the WP at pending_approval, so the wrong photo could
// never be removed. isRevisionWindowOpen() is the second arm — it mirrors
// photo_removal_allowed() (migration 075831) minus the per-photo uploader
// check, which only the server action and RLS can make.

import type { Database } from "@/lib/db/database.types";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];
type UserRole = Database["public"]["Enums"]["user_role"];
type ApprovalDecision = Database["public"]["Enums"]["approval_decision"];

// Deletable = not_started · in_progress · on_hold · rework. Locked = the two
// below (a submitted evidence set is frozen). Kept as the negative list so the
// predicate and the SQL `status NOT IN (...)` read the same way.
const PHOTO_DELETE_LOCKED_STATUSES: ReadonlyArray<WorkPackageStatus> = [
  "pending_approval",
  "complete",
];

export function isPhotoWpDeletable(status: WorkPackageStatus): boolean {
  return !PHOTO_DELETE_LOCKED_STATUSES.includes(status);
}

export interface RevisionWindowInput {
  status: WorkPackageStatus;
  /** The WP's most recent `approvals` decision (decided_at desc, id desc — the
   *  selectLatestDecisionByWorkPackage idiom), or null when it has none. */
  latestDecision: ApprovalDecision | null;
  /** Whether that decision has already been answered by ส่งตรวจอีกครั้ง
   *  (a `wp_evidence_resubmitted` audit row). Answering re-freezes the set:
   *  the reviewer is looking at it again. */
  revisionAnswered: boolean;
}

export function isRevisionWindowOpen({
  status,
  latestDecision,
  revisionAnswered,
}: RevisionWindowInput): boolean {
  return status === "pending_approval" && latestDecision === "needs_revision" && !revisionAnswered;
}

/**
 * The WP-level half of the delete rule — everything `photo_removal_allowed()`
 * decides except the two per-photo conjuncts (same work package, uploaded by
 * the caller), which only the action and RLS can check. Exported as one pure
 * function so the page has no logic of its own to drift, and so the
 * (status, decision, answered) matrix is testable directly.
 */
export function canDeleteWpPhotos(input: RevisionWindowInput): boolean {
  return isPhotoWpDeletable(input.status) || isRevisionWindowOpen(input);
}

/**
 * Spec 340 U1 — WHO may remove inside an open ให้แก้ไข window. Mirrors the
 * ownership conjunct of `photo_removal_allowed()` (migration 075833):
 * the uploader, or super_admin acting on their behalf.
 *
 * Deliberately says nothing about WP status. The freeze is a STATE rule and is
 * evaluated by the caller before this is ever reached — super_admin does not get
 * to delete on a submitted or complete WP, and folding a status test in here is
 * how that guarantee would quietly disappear.
 */
export function canRemoveInRevisionWindow({
  isUploader,
  role,
}: {
  isUploader: boolean;
  /** The caller's own role, or null when it could not be read — fails closed. */
  role: UserRole | null;
}): boolean {
  return isUploader || role === "super_admin";
}

/** Friendly Thai refusal shown when a delete is attempted on a locked WP. */
export const PHOTO_DELETE_LOCKED_ERROR = "งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้";

/** Refusal for the one case the window admits but the caller does not own: the
 *  reviewer asked for a re-shoot, so only the person who took the photo may
 *  replace it. */
export const PHOTO_DELETE_NOT_OWNER_ERROR = "ระหว่างรอแก้ไข ลบได้เฉพาะรูปที่คุณถ่ายเอง";
