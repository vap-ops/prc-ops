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

export type NotificationEventType = Database["public"]["Enums"]["notification_event_type"];

export interface ComposeContext {
  wpCode?: string;
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

export function composeNotification(
  eventType: NotificationEventType,
  payload: NotificationPayload,
  context: ComposeContext,
): string {
  switch (eventType) {
    case "wp_pending_approval":
      return `งานรอตรวจ: ${payload.code ?? ""} ${payload.name ?? ""}`.trim();

    case "wp_decision": {
      const head = `ผลการตรวจ ${context.wpCode ?? ""}: ${label(
        APPROVAL_DECISION_LABEL,
        payload.decision,
      )}`;
      return payload.comment ? `${head}\nความเห็น: ${payload.comment}` : head;
    }

    // Spec 218 U5 — a defect reopened the WP to งานแก้ไข. The reason/source live in
    // the app's "ต้องแก้ไข" surface; the ping names the WP + round and sends them in.
    case "wp_reopened": {
      const round = payload.round && payload.round >= 1 ? ` (รอบ ${payload.round})` : "";
      return `งานถูกเปิดใหม่เพื่อแก้ไข${round}: ${payload.code ?? ""} ${payload.name ?? ""} — เปิดแอปดูข้อบกพร่อง`.trim();
    }

    // Spec 337 U1 (F2) — the SA re-shot what the decision asked for and pressed
    // ส่งตรวจอีกครั้ง; the decider is told this one is ready to look at again.
    case "wp_evidence_resubmitted":
      return `ส่งตรวจอีกครั้ง: ${payload.code ?? ""} ${payload.name ?? ""} — ถ่ายรูปเพิ่มหลังให้แก้ไขแล้ว`.trim();

    case "pr_created":
      return `คำขอซื้อใหม่ ${prRef(payload.prNumber, context.poNumber)}: ${payload.itemDescription ?? ""} (${String(payload.quantity ?? "")} ${payload.unit ?? ""})`;

    case "pr_decision": {
      const head = `คำขอซื้อ ${prRef(payload.prNumber, context.poNumber)}: ${label(
        PURCHASE_REQUEST_STATUS_LABEL,
        payload.transition?.[1],
      )}`;
      return payload.decisionComment ? `${head}\nความเห็น: ${payload.decisionComment}` : head;
    }

    case "pr_progress":
      return `คำขอซื้อ ${prRef(payload.prNumber, context.poNumber)}: ${label(
        PURCHASE_REQUEST_STATUS_LABEL,
        payload.transition?.[1],
      )}`;

    case "pr_cancelled": {
      const head = `คำขอซื้อ ${prRef(payload.prNumber, context.poNumber)} ถูกยกเลิก`;
      return payload.cancellationReason ? `${head}\nเหตุผล: ${payload.cancellationReason}` : head;
    }

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
