// Decision logic for the photo-driven WP status transition (spec 03
// decision 14). When the first After photo lands on a WP whose status
// is not_started / in_progress / on_hold, the addPhoto action flips it
// to pending_approval. Already-pending / already-complete WPs are
// never regressed.
//
// Per spec 03 decision 15 the operator picked option (a) — admin-
// client escalation INSIDE the upload server action. The transition
// itself is a single guarded UPDATE (this decision predicates it; the
// SQL guard in the action mirrors it so the rule is enforced in two
// independent layers).

import type { PhotoPhase, WorkPackageStatus } from "@/lib/db/enums";

export type { PhotoPhase, WorkPackageStatus };

// Spec 144: 'rework' (a defect reopened a complete WP) is transitionable —
// re-shooting the After photo sends it back to pending_approval, same as the
// other pre-approval states.
export const TRANSITIONABLE_FROM_STATUSES = [
  "not_started",
  "in_progress",
  "on_hold",
  "rework",
] as const;

export function shouldTransitionToPendingApproval(
  phase: PhotoPhase,
  currentStatus: WorkPackageStatus,
): boolean {
  // Feedback 0fa23307: a rework's completion photo (after_fix / หลังแก้ไข) sends
  // the WP to review the same as the original After photo — so capturing it on a
  // งานแก้ไข WP closes the rework loop (rework → pending_approval).
  if (phase !== "after" && phase !== "after_fix") return false;
  return (TRANSITIONABLE_FROM_STATUSES as readonly string[]).includes(currentStatus);
}

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
