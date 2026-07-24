// Spec 337 U2a (F2) — the cure loop's closing act.
//
// A needs_revision decision leaves the WP in the review queue awaiting new
// photos. Nothing used to tell the decider when the SA had answered: the item
// looked unchanged in a 40-deep queue and closed only when a PM happened to
// reopen it. The loop now closes on an EXPLICIT ส่งตรวจอีกครั้ง — operator
// decision 4, deliberately NOT an auto-flip on upload (FB2 removed exactly that
// for sending partly-done work to review, and the PM's ask is free text, so only
// the SA knows when it has been answered).
//
// This module is the WHOLE rule, once: the control renders from it and the
// server action refuses from it, so the button the SA sees and the gate the
// server applies cannot drift. The DB backstop is
// resubmit_work_package_evidence (spec 337 U1), which re-checks every clause.

import type { WorkPackageStatus } from "@/lib/db/enums";

/** The button, and the sheet's confirm. */
export const RESUBMIT_LABEL = "ส่งตรวจอีกครั้ง";
/** Disabled-button hint AND the server action's refusal — one string, one rule. */
export const RESUBMIT_EVIDENCE_HINT = "ถ่ายรูปเพิ่มก่อนจึงจะส่งตรวจอีกครั้งได้";
/** Replaces the button once this bounce is answered — never a dead control. */
export const RESUBMIT_DONE_NOTE = "ส่งตรวจอีกครั้งแล้ว — รอผู้จัดการตรวจ";

/**
 * Spec 337 U2 (approver side) — the review queue splits the needs_revision
 * items in two, because they are NOT equally actionable. This is the other half
 * of the SA-side clear: the moment a bounce leaves the SA's list it must become
 * visibly the decider's move, or the WP belongs to nobody (the ping alone is a
 * mutable, mute-able signal).
 */
export const REVIEW_AWAITING_PHOTOS_LABEL = "รอถ่ายเพิ่ม";
export const REVIEW_READY_AGAIN_LABEL = "พร้อมตรวจอีกครั้ง";

/** The queue row's label. `answered` = a resubmit exists for this decision. */
export function reviewQueueLabel(
  decision: string | null,
  answered: boolean,
  fallback: (d: string | null) => string,
): string {
  if (decision !== "needs_revision") return fallback(decision);
  return answered ? REVIEW_READY_AGAIN_LABEL : REVIEW_AWAITING_PHOTOS_LABEL;
}

/**
 * Sort rank: answered bounces first (the decider can act on them NOW), then
 * everything else in the queue's existing oldest-first order. Never re-orders
 * within a rank, so spec 15's updated_at ordering survives underneath.
 */
export function reviewQueueRank(decision: string | null, answered: boolean): number {
  return decision === "needs_revision" && answered ? 0 : 1;
}

export type ResubmitDecision = {
  /** Required on purpose: this joins to the resubmit audit row's
   *  `answers_decision_id`. Optional would let a caller omit `id` from its
   *  select and silently get a live-looking button the RPC then refuses. */
  id: string;
  decision: string;
  decided_at: string;
  /** Who asked for the re-shoot — the ping's recipient, and the one viewer for
   *  whom this control is meaningless. */
  decided_by: string;
};

type PhotoStamp = { created_at: string };
// after_fix photos are round-stamped, so the evidence gate can require the CURRENT
// round's fix (matching canSubmitForApproval) — a stale prior-round photo, e.g. a
// late offline-queue flush (ADR 0039) that lands after the decision with a server
// created_at newer than it, must not answer this bounce.
type ReworkPhotoStamp = PhotoStamp & { rework_round: number };

export type ResubmitState =
  /** Not a cure loop — render nothing. */
  | { kind: "hidden" }
  /** The SA may send it back to the decider now. */
  | { kind: "ready" }
  /** Rendered disabled with `hint` — the photos do not answer this bounce yet. */
  | { kind: "blocked"; hint: string }
  /** Already answered; the decider has been pinged and is looking again. */
  | { kind: "done" };

export interface ResubmitStateArgs {
  status: WorkPackageStatus;
  /** approvals[0] — the newest decision on this WP, or null if never reviewed. */
  latestDecision: ResubmitDecision | null;
  currentPhotos: {
    after: ReadonlyArray<PhotoStamp>;
    after_fix: ReadonlyArray<ReworkPhotoStamp>;
  };
  /** `answers_decision_id` of every wp_evidence_resubmitted audit row on this WP. */
  answeredDecisionIds: ReadonlySet<string>;
  /** Spec 353 — the WP's rework_round decides which phase is completion evidence:
   *  reworked (>0) → a new after_fix answers the bounce; else the `after` photo. So
   *  reject-evidence points at exactly one phase to re-shoot. */
  reworkRound: number;
  /** The signed-in viewer. PM_ROLES ⊂ SITE_STAFF_ROLES, so the decider can reach
   *  this control on their own bounce — see the guard below. */
  viewerId: string;
}

export function resubmitState(args: ResubmitStateArgs): ResubmitState {
  const { status, latestDecision, currentPhotos, answeredDecisionIds, reworkRound, viewerId } =
    args;

  // The cure loop exists only while the WP is still in the queue AND the last
  // word from the decider was "re-shoot". `rejected` now leaves pending_approval
  // outright (F3) and `approved` closes the WP, so neither can be a cure.
  if (status !== "pending_approval") return { kind: "hidden" };
  if (!latestDecision || latestDecision.decision !== "needs_revision") return { kind: "hidden" };

  // The DECIDER themself must not see this. ส่งตรวจอีกครั้ง means "tell the person
  // who asked" — telling yourself notifies nobody (resolveRecipients excludes the
  // actor, so the recipient list would be EMPTY), while the RPC's per-decision
  // idempotency burns the one resubmit and the SA's list item disappears: a WP
  // in nobody's queue. A decider looking at their own bounce already has the
  // right control — the decision form on /review.
  if (latestDecision.decided_by === viewerId) return { kind: "hidden" };

  // Checked BEFORE the photo gate: once answered, the RPC refuses a second
  // resubmit, so a button here could only ever error.
  if (answeredDecisionIds.has(latestDecision.id)) {
    return { kind: "done" };
  }

  // Timestamps cross tables (photo_logs.created_at vs approvals.decided_at), so
  // parse rather than compare the strings — PostgREST's offset formatting is not
  // something this rule should depend on. STRICTLY newer: a photo stamped at the
  // decision instant is what the decider was already looking at.
  const boundary = Date.parse(latestDecision.decided_at);
  const isNew = (p: PhotoStamp) => Date.parse(p.created_at) > boundary;
  // Spec 353 — key on the CURRENT evidence phase, not after-OR-after_fix: a reworked
  // WP re-shoots the CURRENT round's after_fix (matching canSubmitForApproval — a
  // stale prior-round fix must not answer the bounce), a round-0 WP re-shoots the
  // `after` photo. So reject-evidence is unambiguous, and a stray photo (wrong phase
  // or wrong round) can't satisfy it.
  const evidence =
    reworkRound > 0
      ? currentPhotos.after_fix.filter((p) => p.rework_round === reworkRound)
      : currentPhotos.after;
  if (!evidence.some(isNew)) {
    return { kind: "blocked", hint: RESUBMIT_EVIDENCE_HINT };
  }

  return { kind: "ready" };
}
