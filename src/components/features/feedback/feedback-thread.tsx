// Spec 201 U2 — the conversation on a feedback report. Read-only presentational
// list: each message oldest-first, labelled by author kind (ทีมงาน / ผู้แจ้ง /
// ผู้ช่วย AI) with its time. Team messages (operator/agent) carry a left accent so
// the reporter can tell a reply from their own words at a glance.

import { EmptyNotice } from "@/components/features/common/notices";
import { CARD } from "@/lib/ui/classes";
import { FEEDBACK_AUTHOR_LABEL, formatThaiDateTime } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type FeedbackAuthorKind = Database["public"]["Enums"]["feedback_author_kind"];

export type ThreadMessage = {
  id: string;
  authorKind: FeedbackAuthorKind;
  body: string;
  createdAt: string;
};

export function FeedbackThread({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return <EmptyNotice>ยังไม่มีการตอบกลับ</EmptyNotice>;
  }

  // Oldest-first — a conversation reads top-down.
  const ordered = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <ul className="flex flex-col gap-3">
      {ordered.map((m) => {
        const fromTeam = m.authorKind !== "reporter";
        return (
          <li
            key={m.id}
            className={`${CARD} flex flex-col gap-1 ${fromTeam ? "border-action border-l-4" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-ink text-sm font-semibold">
                {FEEDBACK_AUTHOR_LABEL[m.authorKind]}
              </span>
              <span className="text-ink-muted ml-auto text-xs">
                {formatThaiDateTime(m.createdAt)}
              </span>
            </div>
            <p className="text-ink-secondary text-sm whitespace-pre-wrap">{m.body}</p>
          </li>
        );
      })}
    </ul>
  );
}
