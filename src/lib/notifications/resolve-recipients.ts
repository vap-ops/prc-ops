// Spec 32 §2 — recipient rules per event type (ADR 0037). Pure: the
// drainer supplies the PM/super pool and the WP's photo uploaders; this
// module applies the routing rule, the actor exclusion (no
// self-notification), and dedupe. Returned ids are user ids — mapping to
// LINE ids (and dropping users without one) happens in the drainer.

import type { NotificationEventType } from "./compose-notification";
import type { NotificationPayload } from "./payload";
import { warnUnknownNotificationEvent } from "./unknown-event";

export interface RecipientContext {
  /**
   * Spec 318 U5 — the EVENT's project-scoped PM-tier recipients (project lead +
   * PM-tier project_members), resolved per-row in the drain. `null` means the
   * project could NOT be resolved (pre-318 queue rows without a project payload,
   * WP-less PRs) → the legacy full-pool fallback applies so nothing is dropped
   * mid-transition. `[]` means the project is known but has no PM (the org-wide
   * pool still fires).
   */
  eventProjectPmIds: ReadonlyArray<string> | null;
  /** Org-wide approval pool: every project_director + super_admin (see-all tiers). */
  orgWidePmIds: ReadonlyArray<string>;
  /** The pre-318 org-wide PM_ROLES pool — fallback only (unresolvable project). */
  legacyPmPoolIds: ReadonlyArray<string>;
  /** Distinct photo uploader ids for the event's work package. */
  wpUploaderIds: ReadonlyArray<string>;
  /** Every super_admin user id — the operator pool for feedback (spec 201 A4). */
  superIds: ReadonlyArray<string>;
  /**
   * Spec 277 P1a — the issue's PROJECT PMs (lead + PM-tier members), resolved
   * per-row in the drain from the payload's project_id. Empty when the project
   * has no PM (the zero-PM fallback: only the role pool is alerted).
   */
  siteIssueProjectPmIds: ReadonlyArray<string>;
  /**
   * Spec 277 P1a — the role-wide alert pool (every project_director +
   * procurement_manager). Always alerted for a serious issue, deduped against
   * the project PMs.
   */
  siteIssueRolePoolIds: ReadonlyArray<string>;
  /**
   * Spec 324 — the back-office correction authority pool (every BACK_OFFICE_ROLES
   * user), alerted when an SA flags a receipt miscount. Role-wide (the correction
   * queue is not project-bound). Empty for every non-correction event.
   */
  backOfficeIds: ReadonlyArray<string>;
}

function unique(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids)];
}

function without(ids: ReadonlyArray<string>, excluded: string | undefined): string[] {
  return unique(ids).filter((id) => id !== excluded);
}

export function resolveRecipients(
  eventType: NotificationEventType,
  payload: NotificationPayload,
  context: RecipientContext,
): string[] {
  // Spec 318 U5 — PM-approval events are project-scoped (audit P1 cluster E):
  // the event project's PMs + the org-wide PD/super pool; legacy full pool only
  // when the project is unresolvable.
  const approvalPool =
    context.eventProjectPmIds === null
      ? context.legacyPmPoolIds
      : [...context.eventProjectPmIds, ...context.orgWidePmIds];

  switch (eventType) {
    case "wp_pending_approval":
      return unique(approvalPool);
    case "pr_created":
      return without(approvalPool, payload.requestedBy);
    case "wp_decision":
      return without(context.wpUploaderIds, payload.decidedBy);
    // Spec 218 U5 — a defect reopened the WP; ping the SAs who shot it (minus the
    // reopener — no self-notification) to come fix it.
    case "wp_reopened":
      return without(context.wpUploaderIds, payload.reopenedBy);
    // Spec 337 U1 (F2) — the SA answered a needs_revision and pressed
    // ส่งตรวจอีกครั้ง. Targets the DECIDER, a PERSON, deliberately NOT the approval
    // pool: they wrote the free-text ask, so only they can judge whether it was
    // answered, and the queue is already 40 deep without a pool-wide re-ping.
    case "wp_evidence_resubmitted":
      return payload.decidedBy ? without([payload.decidedBy], payload.resubmittedBy) : [];
    case "pr_decision":
      return payload.requestedBy ? without([payload.requestedBy], payload.decidedBy) : [];
    case "pr_progress":
      return payload.requestedBy ? [payload.requestedBy] : [];
    case "pr_cancelled":
      return payload.requestedBy ? without([payload.requestedBy], payload.cancelledBy) : [];
    // Spec 201 A4 — a new feedback report pings the operator pool (super_admins).
    // A super filing their own report is excluded (no self-notification).
    case "feedback_submitted":
      return without(context.superIds, payload.submittedBy);
    // Spec 277 P1a — a serious site issue pings the project's PMs (lead + PM
    // members) plus the role-wide director/procurement pool, deduped, minus the
    // reporter (a PM/director filing their own issue is not self-pinged).
    case "site_issue_reported":
      return without(
        [...context.siteIssueProjectPmIds, ...context.siteIssueRolePoolIds],
        payload.reportedBy,
      );
    // Spec 324 — an SA flagged a receipt miscount; nudge the back-office
    // correction authority (minus the flagger, if a BO user flagged their own).
    case "receipt_correction_flagged":
      return without(context.backOfficeIds, payload.requestedBy);
    // Spec 324 — the correction was applied/rejected; tell the SA who flagged it
    // (a direct BO correction with no flag carries no requestedBy → nobody).
    case "receipt_correction_resolved":
      return payload.requestedBy ? [payload.requestedBy] : [];
    default:
      // Runtime-only: an event type this deploy predates (see unknown-event).
      // `eventType` is `never` here at compile time, so a new union member
      // forces a case above; at runtime skip safely — a missing recipient rule
      // must never crash the shared drain batch.
      warnUnknownNotificationEvent(eventType);
      return [];
  }
}
