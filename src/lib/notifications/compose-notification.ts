// Spec 32 §2 — Thai message text per event type. Pure; enrichment values
// (WP code for wp_decision) arrive via context, everything else comes from
// the trigger's payload snapshot.

import {
  APPROVAL_DECISION_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  FEEDBACK_TYPE_LABEL,
  USER_ROLE_LABEL,
} from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";
import type { NotificationPayload } from "./payload";

export type NotificationEventType = Database["public"]["Enums"]["notification_event_type"];

export interface ComposeContext {
  wpCode?: string;
}

function label(map: Record<string, string>, value: string | undefined): string {
  if (value === undefined) return "";
  return map[value] ?? value;
}

function formatPrNumber(prNumber: number | undefined): string {
  return `PR-${String(prNumber ?? 0).padStart(4, "0")}`;
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

    case "pr_created":
      return `คำขอซื้อใหม่ ${formatPrNumber(payload.prNumber)}: ${payload.itemDescription ?? ""} (${String(payload.quantity ?? "")} ${payload.unit ?? ""})`;

    case "pr_decision": {
      const head = `คำขอซื้อ ${formatPrNumber(payload.prNumber)}: ${label(
        PURCHASE_REQUEST_STATUS_LABEL,
        payload.transition?.[1],
      )}`;
      return payload.decisionComment ? `${head}\nความเห็น: ${payload.decisionComment}` : head;
    }

    case "pr_progress":
      return `คำขอซื้อ ${formatPrNumber(payload.prNumber)}: ${label(
        PURCHASE_REQUEST_STATUS_LABEL,
        payload.transition?.[1],
      )}`;

    case "pr_cancelled": {
      const head = `คำขอซื้อ ${formatPrNumber(payload.prNumber)} ถูกยกเลิก`;
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
