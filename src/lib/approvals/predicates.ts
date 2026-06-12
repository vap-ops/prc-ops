// Pure predicates shared by the record-decision form (client-side
// validation) and the recordDecision server action (defense-in-depth
// validation + transition gate). Keeping them pure / typed means the
// client and server can't drift on the "is this comment valid?" rule
// and the SQL guard in the action mirrors a JS predicate that's
// individually testable.

import type { ApprovalDecision, WorkPackageStatus } from "@/lib/db/enums";

export type { ApprovalDecision, WorkPackageStatus };

// Sorted alphabetically — matches the enum's natural order and gives
// the form a deterministic radio ordering.
export const APPROVAL_DECISIONS: ReadonlyArray<ApprovalDecision> = [
  "approved",
  "needs_revision",
  "rejected",
];

export function commentRequiredFor(decision: ApprovalDecision): boolean {
  return decision !== "approved";
}

export function isCommentValid(decision: ApprovalDecision, comment: string | null): boolean {
  if (!commentRequiredFor(decision)) return true;
  if (comment === null) return false;
  return comment.trim().length > 0;
}

// approved + the WP is currently pending_approval → flip to complete.
// Mirrors shouldTransitionToPendingApproval (spec 03 option-(a) pattern)
// — predicate decides, SQL guard reinforces.
export function shouldTransitionToComplete(
  decision: ApprovalDecision,
  currentStatus: WorkPackageStatus,
): boolean {
  return decision === "approved" && currentStatus === "pending_approval";
}
