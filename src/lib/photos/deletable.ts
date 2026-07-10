// Spec 291 U1 — the photo-delete submit gate, shared by the server action
// (removePhoto) and the UI (capture-sheet). Mirrors the photo_wp_deletable()
// RLS helper (migration 075630, the authority): a progress photo is per-WP
// approval evidence, so a delete (tombstone) is admitted only while the WP is
// still editable and refused once it is submitted for approval or complete.

import type { Database } from "@/lib/db/database.types";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

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

/** Friendly Thai refusal shown when a delete is attempted on a locked WP. */
export const PHOTO_DELETE_LOCKED_ERROR = "งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้";
