// Pure predicates shared by the record-decision form (client-side
// validation) and the recordDecision server action (defense-in-depth
// validation + transition gate). Keeping them pure / typed means the
// client and server can't drift on the "is this comment valid?" rule
// and the SQL guard in the action mirrors a JS predicate that's
// individually testable.

import type { ApprovalDecision, WorkPackageStatus } from "@/lib/db/enums";

export type { ApprovalDecision, WorkPackageStatus };

// NOTE (spec 337 U1): shouldTransitionToComplete lived here and told the action
// whether to run its own admin-client flip. decide_work_package now owns the
// flip and RETURNS the resulting status, so the predicate had exactly one
// caller and no remaining truth to hold — removed rather than left orphaned.

// Sorted alphabetically — matches the enum's natural order and gives
// the form a deterministic radio ordering.
export const APPROVAL_DECISIONS: ReadonlyArray<ApprovalDecision> = [
  "approved",
  "needs_revision",
  "rejected",
];

/**
 * "This WP is not up for review." Shared by every write that only makes sense
 * while the WP sits in the queue — recordDecision and, since spec 337 U2a, the
 * ส่งตรวจอีกครั้ง resubmit — so the two cannot drift into different wordings for
 * the same situation (UI-term SSOT rule: a user-facing sentence used by 2+
 * surfaces gets one home).
 */
export const NOT_PENDING_REVIEW_ERROR = "รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ";

// Spec 355 — the comment is required only for reject-work (rejected), which carries
// the defect description. reject-evidence (needs_revision) carries a structured
// reason instead (see revisionReasonRequiredFor); its comment is optional detail.
export function commentRequiredFor(decision: ApprovalDecision): boolean {
  return decision === "rejected";
}

// Spec 355 — reject-evidence must say WHY (incomplete / mismatch / premature) so the
// SA gets the right next-action. Required only for needs_revision.
export function revisionReasonRequiredFor(decision: ApprovalDecision): boolean {
  return decision === "needs_revision";
}

export function isCommentValid(decision: ApprovalDecision, comment: string | null): boolean {
  if (!commentRequiredFor(decision)) return true;
  if (comment === null) return false;
  return comment.trim().length > 0;
}
