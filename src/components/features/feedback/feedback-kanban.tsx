// Spec 201 (review kanban) — the super_admin triage board. The four lifecycle
// statuses are columns; each report is a compact card. There is no drag (poor on
// mobile, the operator's device, and no dnd dependency): the card's status control
// moves it — picking a new status calls set_feedback_status and the card lands in
// that column on refresh. Cards link to the full conversation. Columns scroll
// horizontally on a narrow screen.

import Link from "next/link";
import { FeedbackStatusControl } from "@/components/features/feedback/feedback-status-control";
import { groupFeedbackByStatus, FEEDBACK_STATUS_ORDER } from "@/lib/feedback/kanban";
import { withBackFrom } from "@/lib/nav/back-href";
import { CARD } from "@/lib/ui/classes";
import {
  FEEDBACK_TYPE_LABEL,
  FEEDBACK_STATUS_LABEL,
  USER_ROLE_LABEL,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type FeedbackStatus = Database["public"]["Enums"]["feedback_status"];
type FeedbackType = Database["public"]["Enums"]["feedback_type"];
type UserRole = Database["public"]["Enums"]["user_role"];

export type FeedbackCardVM = {
  id: string;
  type: FeedbackType;
  status: FeedbackStatus;
  title: string;
  body: string;
  createdAt: string;
  roleSnapshot: UserRole;
  appVersion: string | null;
  userAgent: string | null;
  screen: string | null;
  pagePath: string | null;
  attachmentUrls: string[];
};

const TYPE_BADGE: Record<FeedbackType, string> = {
  bug: "border-danger-edge bg-danger-soft text-danger-ink",
  feature: "border-action bg-action-soft text-action",
};
const COLUMN_ACCENT: Record<FeedbackStatus, string> = {
  open: "text-attn-ink",
  in_progress: "text-action",
  done: "text-done-ink",
  declined: "text-ink-secondary",
};
const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";

function deviceLabel(ua: string | null): string {
  if (!ua) return "—";
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? "มือถือ" : "เดสก์ท็อป";
}

export function FeedbackKanban({ cards }: { cards: FeedbackCardVM[] }) {
  const columns = groupFeedbackByStatus(cards);

  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-2">
      <div className="flex min-w-full gap-3">
        {columns.map((col) => (
          <section key={col.status} className="flex w-72 shrink-0 flex-col gap-3">
            <h3 className={`text-sm font-semibold ${COLUMN_ACCENT[col.status]}`}>
              {FEEDBACK_STATUS_LABEL[col.status]}
              <span className="text-ink-muted ml-1 font-normal">{col.items.length}</span>
            </h3>

            {col.items.length === 0 ? (
              <p className="border-edge text-ink-muted rounded-control border border-dashed px-3 py-6 text-center text-xs">
                ว่าง
              </p>
            ) : (
              col.items.map((f) => (
                <article key={f.id} className={`${CARD} flex flex-col gap-2`}>
                  <div className="flex items-center gap-2">
                    <span className={`${BADGE} ${TYPE_BADGE[f.type]}`}>
                      {FEEDBACK_TYPE_LABEL[f.type]}
                    </span>
                    <span className="text-ink-muted ml-auto text-xs">
                      {formatThaiDateTime(f.createdAt)}
                    </span>
                  </div>

                  <p className="text-ink text-sm font-semibold">{f.title}</p>
                  <p className="text-ink-secondary line-clamp-3 text-xs whitespace-pre-wrap">
                    {f.body}
                  </p>

                  {f.attachmentUrls.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {f.attachmentUrls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="focus-visible:ring-action rounded-control focus:outline-none focus-visible:ring-2"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`รูปแนบ ${i + 1}`}
                            className="rounded-control border-edge size-12 border object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  <p className="text-ink-muted text-xs">
                    {USER_ROLE_LABEL[f.roleSnapshot]} · {deviceLabel(f.userAgent)}
                    {f.appVersion ? ` · ${f.appVersion}` : ""}
                  </p>
                  {f.pagePath ? (
                    <p className="text-ink-muted font-mono text-[10px] break-all">{f.pagePath}</p>
                  ) : null}

                  <FeedbackStatusControl id={f.id} status={f.status} />

                  <Link
                    href={withBackFrom(`/feedback/${f.id}`, "/feedback/review")}
                    className="text-action text-xs font-medium underline-offset-2 hover:underline"
                  >
                    ดูบทสนทนา / ตอบกลับ →
                  </Link>
                </article>
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export { FEEDBACK_STATUS_ORDER };
