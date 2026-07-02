// Decision logic for the photo-driven WP status transitions.
//
// FB2 (b9e942f0): the After-photo → pending_approval auto-flip (spec 03 decision
// 14) was REMOVED — it sent a partly-done WP to review on its first "after"
// photo. Submitting for approval is now an explicit SA act
// (submitWorkPackageForApproval / the "ส่งงานเข้าตรวจ" button), which reuses
// TRANSITIONABLE_FROM_STATUSES below as its allowed-from set. The During →
// in_progress flip stays (operator kept it).

import type { PhotoPhase, WorkPackageStatus } from "@/lib/db/enums";

export type { PhotoPhase, WorkPackageStatus };

// The statuses a WP may be submitted for approval FROM — consumed by the
// submitWorkPackageForApproval action's SQL guard. Spec 144: 'rework' (a defect
// reopened a complete WP) is included — fixing it and submitting sends it back to
// review, same as the other pre-approval states. pending_approval / complete are
// excluded so a submit can never regress them.
export const TRANSITIONABLE_FROM_STATUSES = [
  "not_started",
  "in_progress",
  "on_hold",
  "rework",
] as const;

// Spec 52: the first During photo flips a not_started WP to in_progress.
// From not_started ONLY — a During upload must not release on_hold (the
// hold is a deliberate PM flag, spec 52 part B), unlike the After rule
// above, which does transition out of on_hold by spec-03 decision.
export function shouldTransitionToInProgress(
  phase: PhotoPhase,
  currentStatus: WorkPackageStatus,
): boolean {
  return phase === "during" && currentStatus === "not_started";
}

// Spec 247 — the photo gate on "ส่งงานเข้าตรวจ": submitting requires current
// completion evidence. First pass (not_started/in_progress/on_hold) = ≥1 after
// photo; rework = ≥1 after_fix photo of the WP's CURRENT rework_round (a prior
// round's fix photo is stale evidence for this defect cycle). Callers pass the
// already-current-filtered read (selectCurrentPhotosByPhase — anti-join +
// tombstone, ADR 0009/0015), so a deleted photo never counts. The structural
// row type keeps this module import-safe outside server-only code.

type ReworkStampedRow = { rework_round: number };

export function canSubmitForApproval(
  status: WorkPackageStatus,
  currentPhotos: {
    after: ReadonlyArray<ReworkStampedRow>;
    after_fix: ReadonlyArray<ReworkStampedRow>;
  },
  reworkRound: number,
): boolean {
  if (status === "rework") {
    return currentPhotos.after_fix.some((p) => p.rework_round === reworkRound);
  }
  return currentPhotos.after.length > 0;
}

/** The user-facing reason a submit is blocked — same string on the disabled
 *  button hint (UI) and the action refusal (enforcement). */
export function submitEvidenceHint(status: WorkPackageStatus): string {
  return status === "rework"
    ? "ถ่ายรูปหลังแก้ไขก่อนจึงจะส่งตรวจได้"
    : "ถ่ายรูปหลังทำงานก่อนจึงจะส่งตรวจได้";
}
