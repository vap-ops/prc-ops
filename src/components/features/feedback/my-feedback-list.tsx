// Spec 201 U1 — the reporter's own submissions, shown back to them on /feedback.
// Until now a person submitted into a void (the submitter-read RLS existed, but no
// UI surfaced it). This presentational list closes that: each report with its type,
// current status, and submit date, newest-first. Attachments are not shown yet — a
// reporter cannot read their own attachment rows (feedback_attachments is zero-
// authenticated-access); that waits for an owner-read policy in a later unit.

import Link from "next/link";
import { EmptyNotice } from "@/components/features/common/notices";
import { FeedbackNumberTag } from "@/components/features/feedback/feedback-number-tag";
import { withBackFrom } from "@/lib/nav/back-href";
import { CARD } from "@/lib/ui/classes";
import { FEEDBACK_TYPE_LABEL, FEEDBACK_STATUS_LABEL, formatThaiDateTime } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type FeedbackType = Database["public"]["Enums"]["feedback_type"];
type FeedbackStatus = Database["public"]["Enums"]["feedback_status"];

export type MyFeedbackItem = {
  id: string;
  feedbackNumber: number;
  type: FeedbackType;
  status: FeedbackStatus;
  title: string;
  createdAt: string;
  // Spec 201 A2 — the report has a team reply (operator/agent) the reporter hasn't
  // seen yet. Drives the "new reply" dot so a reply is visible without re-polling.
  hasUnreadReply?: boolean;
};

const TYPE_BADGE: Record<FeedbackType, string> = {
  bug: "border-danger-edge bg-danger-soft text-danger-ink",
  feature: "border-action bg-action-soft text-action",
};

const STATUS_BADGE: Record<FeedbackStatus, string> = {
  open: "border-attn-edge bg-attn-soft text-attn-ink",
  in_progress: "border-action bg-action-soft text-action",
  done: "border-done-edge bg-done-soft text-done-ink",
  declined: "border-edge bg-sunk text-ink-secondary",
};

const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";

export function MyFeedbackList({ items }: { items: MyFeedbackItem[] }) {
  if (items.length === 0) {
    return <EmptyNotice>ยังไม่มีเรื่องที่เคยแจ้ง</EmptyNotice>;
  }

  // Newest-first — the page passes them ordered, but the component owns its order
  // so a caller can never surface a stale sort.
  const ordered = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <ul className="flex flex-col gap-3">
      {ordered.map((f) => (
        <li key={f.id}>
          <Link
            href={withBackFrom(`/feedback/${f.id}`, "/feedback/mine")}
            className={`${CARD} hover:bg-sunk focus-visible:ring-action flex flex-col gap-2 focus:outline-none focus-visible:ring-2`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <FeedbackNumberTag feedbackNumber={f.feedbackNumber} />
              <span className={`${BADGE} ${TYPE_BADGE[f.type]}`}>
                {FEEDBACK_TYPE_LABEL[f.type]}
              </span>
              <span className={`${BADGE} ${STATUS_BADGE[f.status]}`}>
                {FEEDBACK_STATUS_LABEL[f.status]}
              </span>
              {f.hasUnreadReply ? (
                <span
                  role="status"
                  aria-label="มีการตอบกลับใหม่"
                  className="bg-attn text-on-attn ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                >
                  ตอบกลับใหม่
                </span>
              ) : null}
              <span className={`text-ink-muted text-xs ${f.hasUnreadReply ? "" : "ml-auto"}`}>
                {formatThaiDateTime(f.createdAt)}
              </span>
            </div>
            <p className="text-ink text-base font-semibold">{f.title}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
