// Spec 32 §2 — recipient rules per event type (ADR 0037). Pure: the
// drainer supplies the PM/super pool and the WP's photo uploaders; this
// module applies the routing rule, the actor exclusion (no
// self-notification), and dedupe. Returned ids are user ids — mapping to
// LINE ids (and dropping users without one) happens in the drainer.

import type { NotificationEventType } from "./compose-notification";
import type { NotificationPayload } from "./payload";

export interface RecipientContext {
  /** Every project_manager + super_admin user id. */
  pmIds: ReadonlyArray<string>;
  /** Distinct photo uploader ids for the event's work package. */
  wpUploaderIds: ReadonlyArray<string>;
  /** Every super_admin user id — the operator pool for feedback (spec 201 A4). */
  superIds: ReadonlyArray<string>;
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
  }
}
