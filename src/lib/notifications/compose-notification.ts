// Spec 32 §2 — Thai message text per event type. Pure; enrichment values
// (WP code for wp_decision) arrive via context, everything else comes from
// the trigger's payload snapshot.

import {
  APPROVAL_DECISION_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  FEEDBACK_TYPE_LABEL,
  USER_ROLE_LABEL,
  SITE_ISSUE_TYPE_LABEL,
} from "@/lib/i18n/labels";
import { formatPoNumber, formatPrNumber } from "@/lib/purchasing/format-id";
import type { Database } from "@/lib/db/database.types";
import type { NotificationPayload } from "./payload";
import { warnUnknownNotificationEvent } from "./unknown-event";
import {
  buildNotificationMessage,
  joinWhere,
  PR_STATUS_ICON,
  WP_DECISION_ICON,
} from "./message-skeleton";

export type NotificationEventType = Database["public"]["Enums"]["notification_event_type"];

export interface ComposeContext {
  wpCode?: string;
  // Spec 402 U2 — the WP's NAME, resolved by the drain from work_packages.
  // wp_decision's payload carries no name at all, so this is its only source.
  wpName?: string;
  // Spec 211 U8: the parent PO number for a PR event, resolved at compose time
  // (the drain enriches it from purchase_request_id → purchase_order). Absent for
  // a PR with no PO yet.
  poNumber?: number;
  // Spec 277 P1a — site_issue_reported context, enriched by the drain from the
  // payload's project_id / reported_by: the project's name, the reporter's
  // display name, and a deep link into the project.
  projectName?: string;
  issueReporterName?: string;
  issueDeepLink?: string;
  // Feedback c5136ad9 — wp_pending_approval context: the submitter's display
  // name, resolved by the drain from the payload's submitted_by uid.
  submitterName?: string;
  // Spec 402 U1 — the skeleton's shared slots, resolved by the drain.
  // `actorName` is whoever the EVENT attributes the change to; an event whose
  // snapshot cannot honestly name one simply never reads it (see pr_progress).
  // `deepLink` is the absolute URL to the thing the push is about.
  actorName?: string;
  deepLink?: string;
}

function label(map: Record<string, string>, value: string | undefined): string {
  if (value === undefined) return "";
  return map[value] ?? value;
}

// Spec 211 U8 (critic gap X1) — a PR's identity in a notification, naming its
// parent ใบสั่งซื้อ when it has one, so the recipient can tell which ORDER the line
// belongs to (the PR-vs-PO level confusion no longer reaches them pre-screen).
// Uses the U2 SSOT formatters (formatPrNumber was a duplicated local copy).
function prRef(prNumber: number | undefined, poNumber: number | undefined): string {
  const pr = formatPrNumber(prNumber);
  return poNumber !== undefined ? `${pr} · ใบสั่งซื้อ ${formatPoNumber(poNumber)}` : pr;
}

// Spec 402 U1 — the PR family's shared slot builders.

// L2: the item, with its quantity when the payload carries one. A PR whose
// item_description is missing yields "", which the skeleton drops — better a
// four-line message than a line reading "× 10 ถุง" with nothing to count.
function prSubject(payload: NotificationPayload): string {
  const item = payload.itemDescription?.trim() ?? "";
  if (item === "") return "";
  const quantity =
    payload.quantity !== undefined
      ? `${String(payload.quantity)} ${payload.unit ?? ""}`.trim()
      : "";
  return quantity === "" ? item : `${item} × ${quantity}`;
}

// L3: the project, then the PR's own refs.
function prWhere(payload: NotificationPayload, context: ComposeContext): string {
  return joinWhere([context.projectName, prRef(payload.prNumber, context.poNumber)]);
}

// L4 for pr_progress: where the request moved FROM, which the one-line form
// discarded — "ได้รับของแล้ว" alone cannot tell you whether you already knew.
function prTransitionLine(payload: NotificationPayload): string {
  const from = payload.transition?.[0];
  const to = payload.transition?.[1];
  if (from === undefined || to === undefined) return "";
  return `${label(PURCHASE_REQUEST_STATUS_LABEL, from)} → ${label(
    PURCHASE_REQUEST_STATUS_LABEL,
    to,
  )}`;
}

function prStatusIcon(payload: NotificationPayload): string {
  const to = payload.transition?.[1];
  if (to === undefined) return "";
  return PR_STATUS_ICON[to as keyof typeof PR_STATUS_ICON] ?? "";
}

// Spec 402 U2 — the WP family's shared slot builders.

// L2: the work's NAME. The payload snapshot wins where it exists, because it is
// what the work was called WHEN the event happened; wp_decision has no snapshot
// at all, so its name can only come from the drain's join (i.e. current).
function wpSubject(payload: NotificationPayload, context: ComposeContext): string {
  return payload.name?.trim() || (context.wpName?.trim() ?? "");
}

// L3: the project, then the WP code — same precedence as the name.
function wpWhere(payload: NotificationPayload, context: ComposeContext): string {
  return joinWhere([context.projectName, payload.code?.trim() || context.wpCode]);
}

function wpDecisionIcon(payload: NotificationPayload): string {
  const decision = payload.decision;
  if (decision === undefined) return "";
  return WP_DECISION_ICON[decision as keyof typeof WP_DECISION_ICON] ?? "";
}

// An unresolved name drops the whole line rather than rendering a dangling
// prefix — the drain leaves actorName undefined when the lookup found nothing.
function actorLine(prefix: string, name: string | undefined): string {
  const trimmed = name?.trim() ?? "";
  return trimmed === "" ? "" : `${prefix} ${trimmed}`;
}

export function composeNotification(
  eventType: NotificationEventType,
  payload: NotificationPayload,
  context: ComposeContext,
): string {
  switch (eventType) {
    // Spec 402 U2 — the work-package family on the six-slot skeleton. The WP's
    // NAME becomes the subject, the project says where it lives, and the link
    // lands on the surface the recipient can actually open (see below).
    case "wp_pending_approval":
      return buildNotificationMessage({
        headline: "🔎 งานรอตรวจ",
        subject: wpSubject(payload, context),
        where: wpWhere(payload, context),
        // Feedback c5136ad9 — name who submitted; the line disappears when the
        // drain could not resolve a name (system flip / pre-migration rows).
        actor: actorLine("ส่งตรวจโดย", context.submitterName),
        link: context.deepLink,
      });

    // ⭐ This payload snapshots NOTHING about the work — no code, no name, no
    // project (243 of 243 live rows). Every one of those three reaches the
    // reader through the drain's work_packages join, which is why this was the
    // thinnest message in the WP family: "ผลการตรวจ WP-44-02: อนุมัติแล้ว".
    case "wp_decision":
      return buildNotificationMessage({
        headline: `${wpDecisionIcon(payload)} ผลการตรวจ: ${label(
          APPROVAL_DECISION_LABEL,
          payload.decision,
        )}`,
        subject: wpSubject(payload, context),
        where: wpWhere(payload, context),
        actor: actorLine("ตรวจโดย", context.actorName),
        note: payload.comment ? `ความเห็น: ${payload.comment}` : undefined,
        link: context.deepLink,
      });

    // Spec 218 U5 — a defect reopened the WP to งานแก้ไข. The reason/source live in
    // the app's "ต้องแก้ไข" surface, which the link now reaches directly: the old
    // copy ended "— เปิดแอปดูข้อบกพร่อง", a stand-in for exactly that link, so it
    // is retired here rather than left to contradict the tappable URL below it.
    case "wp_reopened":
      return buildNotificationMessage({
        headline: `🔁 เปิดงานใหม่เพื่อแก้ไข${
          payload.round && payload.round >= 1 ? ` (รอบ ${payload.round})` : ""
        }`,
        subject: wpSubject(payload, context),
        where: wpWhere(payload, context),
        actor: actorLine("เปิดโดย", context.actorName),
        link: context.deepLink,
      });

    // Spec 337 U1 (F2) — the SA re-shot what the decision asked for and pressed
    // ส่งตรวจอีกครั้ง; the decider is told this one is ready to look at again.
    case "wp_evidence_resubmitted":
      return buildNotificationMessage({
        headline: "📸 ส่งตรวจอีกครั้ง",
        subject: wpSubject(payload, context),
        where: wpWhere(payload, context),
        actor: actorLine("ถ่ายรูปเพิ่มโดย", context.actorName),
        link: context.deepLink,
      });

    // Spec 402 U1 — the purchase-request family, 81% of every push ever sent.
    // All four take the six-slot skeleton: the ITEM finally reaches the reader
    // (pr_progress has carried item_description in its payload since the
    // trigger was written and never rendered it), the project names where the
    // line lives, and the link lands on the request itself.
    case "pr_created":
      return buildNotificationMessage({
        headline: "🆕 คำขอซื้อใหม่",
        subject: prSubject(payload),
        where: prWhere(payload, context),
        actor: actorLine("ขอโดย", context.actorName),
        link: context.deepLink,
      });

    case "pr_decision":
      return buildNotificationMessage({
        headline: `${prStatusIcon(payload)} คำขอซื้อ: ${label(
          PURCHASE_REQUEST_STATUS_LABEL,
          payload.transition?.[1],
        )}`,
        subject: prSubject(payload),
        where: prWhere(payload, context),
        actor: actorLine("โดย", context.actorName),
        note: payload.decisionComment ? `ความเห็น: ${payload.decisionComment}` : undefined,
        link: context.deepLink,
      });

    // 🚨 No actor line, deliberately. notify_pr_status_change snapshots
    // `decided_by` from `approved_by`, so on a pr_progress row that uid is the
    // PR's APPROVER — not whoever marked it purchased/shipped/delivered.
    // Naming them would attribute the movement to the wrong person, so this arm
    // never reads context.actorName; L4 carries the transition instead.
    case "pr_progress":
      return buildNotificationMessage({
        headline: `${prStatusIcon(payload)} ${label(
          PURCHASE_REQUEST_STATUS_LABEL,
          payload.transition?.[1],
        )} · คำขอซื้อ`,
        subject: prSubject(payload),
        where: prWhere(payload, context),
        actor: prTransitionLine(payload),
        link: context.deepLink,
      });

    case "pr_cancelled":
      return buildNotificationMessage({
        headline: `${PR_STATUS_ICON.cancelled} คำขอซื้อถูกยกเลิก`,
        subject: prSubject(payload),
        where: prWhere(payload, context),
        actor: actorLine("ยกเลิกโดย", context.actorName),
        note: payload.cancellationReason ? `เหตุผล: ${payload.cancellationReason}` : undefined,
        link: context.deepLink,
      });

    // Spec 201 A4 — a new bug report / feature request, to the operator (super_admin).
    // The reporter's role helps the operator triage (mirrors the review card).
    case "feedback_submitted": {
      const type = label(FEEDBACK_TYPE_LABEL, payload.feedbackType);
      const role = label(USER_ROLE_LABEL, payload.roleSnapshot);
      return `ข้อเสนอแนะใหม่ (${type}) จาก${role}: ${payload.feedbackTitle ?? ""}`;
    }

    // Spec 277 P1a — a SERIOUS site issue (safety/access/equipment), to the project
    // PM + the director/procurement pool. Names the issue type + project (· WP when
    // scoped) + reporter, then a deep link into the project to act.
    case "site_issue_reported": {
      const type = label(SITE_ISSUE_TYPE_LABEL, payload.issueType);
      // project · WP, dropping either part when absent (no dangling separator).
      const scope = [context.projectName, context.wpCode]
        .filter((part): part is string => Boolean(part))
        .join(" · ");
      const lines = [`⚠️ ปัญหาหน้างาน (${type}): ${scope}`.trim()];
      if (context.issueReporterName) lines.push(`แจ้งโดย ${context.issueReporterName}`);
      if (context.issueDeepLink) lines.push(context.issueDeepLink);
      return lines.join("\n");
    }

    // Spec 324 — an SA reported that a store receipt was booked with the wrong
    // (over-) count; the back-office correction authority is nudged to true it down.
    case "receipt_correction_flagged":
      return `⚠️ แจ้งแก้ไขจำนวนรับของ: ${payload.itemDescription ?? ""} — โปรดตรวจสอบและแก้ไขให้ตรงกับของที่รับจริง`.trim();

    // Spec 324 — the correction was applied or rejected; the SA who flagged is told.
    case "receipt_correction_resolved":
      return `การแจ้งแก้ไขจำนวนรับของ${payload.itemDescription ? ` (${payload.itemDescription})` : ""} ได้รับการดำเนินการแล้ว`;

    default:
      // Runtime-only: an event type this deploy predates (see unknown-event).
      // `eventType` is `never` here at compile time; at runtime compose to a
      // neutral empty string instead of returning `undefined` and crashing the
      // drain. The row resolves to zero recipients, so this text is never sent.
      warnUnknownNotificationEvent(eventType);
      return "";
  }
}
