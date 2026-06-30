// Spec 32 §2 — Thai message text per event type. Pure; enrichment values
// (WP code for wp_decision) arrive via context, everything else comes from
// the trigger's payload snapshot.

import {
  APPROVAL_DECISION_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  FEEDBACK_TYPE_LABEL,
  USER_ROLE_LABEL,
} from "@/lib/i18n/labels";
import { formatPoNumber, formatPrNumber } from "@/lib/purchasing/format-id";
import type { Database } from "@/lib/db/database.types";
import type { NotificationPayload } from "./payload";

export type NotificationEventType = Database["public"]["Enums"]["notification_event_type"];

export interface ComposeContext {
  wpCode?: string;
  // Spec 211 U8: the parent PO number for a PR event, resolved at compose time
  // (the drain enriches it from purchase_request_id → purchase_order). Absent for
  // a PR with no PO yet.
  poNumber?: number;
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
  }
}
