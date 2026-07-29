// Pure predicates shared by the record-decision form (client-side
// validation) and the recordDecision server action (defense-in-depth
// validation + transition gate). Keeping them pure / typed means the
// client and server can't drift on the "is this comment valid?" rule
// and the SQL guard in the action mirrors a JS predicate that's
// individually testable.

import type { ApprovalDecision, ApprovalRevisionReason, WorkPackageStatus } from "@/lib/db/enums";

export type { ApprovalDecision, ApprovalRevisionReason, WorkPackageStatus };

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

/**
 * Spec 372 U2 — what the PM actually decides.
 *
 * The PM answers อนุมัติ / ไม่อนุมัติ and then says what is WRONG. They never pick a
 * mechanism: three of these causes are `needs_revision` reasons and the fourth is the
 * `rejected` decision, but that is an implementation detail of the RPC, not a question
 * to put to a reviewer. The old form asked it, and the answer was 0 uses of `rejected`
 * and 0 of `premature` in five weeks.
 *
 * `rework` is deliberately NOT named after the enum value it produces — it is the
 * cause ("the work itself must be redone"), and the route is this module's job.
 */
export const DECISION_CAUSES = ["incomplete", "mismatch", "premature", "rework"] as const;
export type DecisionCause = (typeof DECISION_CAUSES)[number];

export interface DecisionPayload {
  decision: ApprovalDecision;
  revisionReason: ApprovalRevisionReason | null;
}

/**
 * The cause → (decision, reason) route. Total over DECISION_CAUSES, and every result
 * satisfies the RPC's own two rules: a reason is REQUIRED for `needs_revision` and
 * REFUSED on anything else (both `22023`).
 */
export function decisionPayloadForCause(cause: DecisionCause): DecisionPayload {
  if (cause === "rework") return { decision: "rejected", revisionReason: null };
  return { decision: "needs_revision", revisionReason: cause };
}

/**
 * Spec 372 U4a — which phases the PM may flag as missing.
 *
 * `incomplete` points at ABSENCE, and only a phase can carry that: you cannot tap a
 * photo that was never taken. Exactly the three lifecycle phases, in capture order —
 * `after_fix` and `defect` are not a normal cycle's completion evidence, so "this
 * phase is missing" is meaningless for them and `decide_work_package` raises 22023.
 */
export const FLAGGABLE_PHASES = ["before", "during", "after"] as const;
export type FlaggablePhase = (typeof FLAGGABLE_PHASES)[number];

/**
 * What the form sends as targets. Keyed on the cause, so the client never offers the
 * RPC a combination it will refuse: phases ride ONLY on `incomplete`.
 *
 * An empty tick-list sends `null`, not `[]` — a PM who cannot say which phase is
 * missing still gets to bounce the photos, and an empty array would be a positive
 * claim that nothing is missing.
 */
export function targetsForCause(
  cause: DecisionCause,
  phases: ReadonlyArray<FlaggablePhase>,
  photoIds: ReadonlyArray<string> = [],
): { targetPhases: FlaggablePhase[] | null; targetPhotoIds: string[] | null } {
  return {
    targetPhases: cause === "incomplete" && phases.length > 0 ? [...phases] : null,
    // Spec 372 U4b — `mismatch` points at photos that EXIST. One cause, one shape:
    // the RPC raises 22023 for either mixture, so the client never offers one.
    targetPhotoIds: cause === "mismatch" && photoIds.length > 0 ? [...photoIds] : null,
  };
}

export function isCommentValid(decision: ApprovalDecision, comment: string | null): boolean {
  if (!commentRequiredFor(decision)) return true;
  if (comment === null) return false;
  return comment.trim().length > 0;
}
