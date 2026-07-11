// Spec 32 / ADR 0037 — typed view over notification_outbox.payload.
// Payloads are NEW-row snapshots written by the capture triggers; every
// field is optional because each event type snapshots different columns.

export interface NotificationPayload {
  // wp_pending_approval
  code?: string;
  name?: string;
  // wp_decision
  decision?: string;
  comment?: string;
  decidedBy?: string;
  // wp_reopened (spec 218 U5) — code/name reused from above; round + the reopener.
  round?: number;
  reopenedBy?: string;
  // pr_*
  itemDescription?: string;
  quantity?: number;
  unit?: string;
  requestedBy?: string;
  prNumber?: number;
  transition?: readonly [string, string];
  decisionComment?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  // feedback_submitted (spec 201 A4)
  feedbackId?: string;
  feedbackType?: string;
  feedbackTitle?: string;
  roleSnapshot?: string;
  submittedBy?: string;
  // site_issue_reported (spec 277 P1a) — the WP rides on the outbox row's
  // work_package_id (like wp_pending_approval), so only project/type/reporter
  // ride in payload.
  projectId?: string;
  issueType?: string;
  reportedBy?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseNotificationPayload(json: unknown): NotificationPayload {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const record = json as Record<string, unknown>;

  let transition: readonly [string, string] | undefined;
  const rawTransition = record["transition"];
  if (
    Array.isArray(rawTransition) &&
    rawTransition.length === 2 &&
    typeof rawTransition[0] === "string" &&
    typeof rawTransition[1] === "string"
  ) {
    transition = [rawTransition[0], rawTransition[1]];
  }

  const payload: NotificationPayload = {};
  const code = str(record["code"]);
  if (code !== undefined) payload.code = code;
  const name = str(record["name"]);
  if (name !== undefined) payload.name = name;
  const decision = str(record["decision"]);
  if (decision !== undefined) payload.decision = decision;
  const comment = str(record["comment"]);
  if (comment !== undefined) payload.comment = comment;
  const decidedBy = str(record["decided_by"]);
  if (decidedBy !== undefined) payload.decidedBy = decidedBy;
  const round = num(record["round"]);
  if (round !== undefined) payload.round = round;
  const reopenedBy = str(record["reopened_by"]);
  if (reopenedBy !== undefined) payload.reopenedBy = reopenedBy;
  const itemDescription = str(record["item_description"]);
  if (itemDescription !== undefined) payload.itemDescription = itemDescription;
  const quantity = num(record["quantity"]);
  if (quantity !== undefined) payload.quantity = quantity;
  const unit = str(record["unit"]);
  if (unit !== undefined) payload.unit = unit;
  const requestedBy = str(record["requested_by"]);
  if (requestedBy !== undefined) payload.requestedBy = requestedBy;
  const prNumber = num(record["pr_number"]);
  if (prNumber !== undefined) payload.prNumber = prNumber;
  if (transition !== undefined) payload.transition = transition;
  const decisionComment = str(record["decision_comment"]);
  if (decisionComment !== undefined) payload.decisionComment = decisionComment;
  const cancelledBy = str(record["cancelled_by"]);
  if (cancelledBy !== undefined) payload.cancelledBy = cancelledBy;
  const cancellationReason = str(record["cancellation_reason"]);
  if (cancellationReason !== undefined) payload.cancellationReason = cancellationReason;
  const feedbackId = str(record["feedback_id"]);
  if (feedbackId !== undefined) payload.feedbackId = feedbackId;
  const feedbackType = str(record["feedback_type"]);
  if (feedbackType !== undefined) payload.feedbackType = feedbackType;
  const feedbackTitle = str(record["feedback_title"]);
  if (feedbackTitle !== undefined) payload.feedbackTitle = feedbackTitle;
  const roleSnapshot = str(record["role_snapshot"]);
  if (roleSnapshot !== undefined) payload.roleSnapshot = roleSnapshot;
  const submittedBy = str(record["submitted_by"]);
  if (submittedBy !== undefined) payload.submittedBy = submittedBy;
  const projectId = str(record["project_id"]);
  if (projectId !== undefined) payload.projectId = projectId;
  const issueType = str(record["issue_type"]);
  if (issueType !== undefined) payload.issueType = issueType;
  const reportedBy = str(record["reported_by"]);
  if (reportedBy !== undefined) payload.reportedBy = reportedBy;
  return payload;
}
