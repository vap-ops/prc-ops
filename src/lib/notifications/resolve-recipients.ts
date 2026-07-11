// Spec 32 §2 — recipient rules per event type (ADR 0037). Pure: the
// drainer supplies the PM/super pool and the WP's photo uploaders; this
// module applies the routing rule, the actor exclusion (no
// self-notification), and dedupe. Returned ids are user ids — mapping to
// LINE ids (and dropping users without one) happens in the drainer.

import type { NotificationEventType } from "./compose-notification";
import type { NotificationPayload } from "./payload";
import { warnUnknownNotificationEvent } from "./unknown-event";

export interface RecipientContext {
  /** Every PM-tier user id (project_manager / super_admin / project_director). */
  pmIds: ReadonlyArray<string>;
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
  switch (eventType) {
    case "wp_pending_approval":
      return unique(context.pmIds);
    case "pr_created":
      return without(context.pmIds, payload.requestedBy);
    case "wp_decision":
      return without(context.wpUploaderIds, payload.decidedBy);
    // Spec 218 U5 — a defect reopened the WP; ping the SAs who shot it (minus the
    // reopener — no self-notification) to come fix it.
    case "wp_reopened":
      return without(context.wpUploaderIds, payload.reopenedBy);
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
    default:
      // Runtime-only: an event type this deploy predates (see unknown-event).
      // `eventType` is `never` here at compile time, so a new union member
      // forces a case above; at runtime skip safely — a missing recipient rule
      // must never crash the shared drain batch.
      warnUnknownNotificationEvent(eventType);
      return [];
  }
}
