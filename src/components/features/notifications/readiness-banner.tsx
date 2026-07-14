// Spec 318 U2 — OA-friend readiness banner. Renders ONLY for a confirmed
// non-friend (friendFlag === false): null means "never probed" (the flag
// populates at the user's next login — don't nag on unknown), true means
// pushes already reach them. Presentational; pages fetch readiness via
// loadNotificationReadiness (server) and pass it down.

import { BellRing } from "lucide-react";
import {
  NOTIF_ADD_FRIEND_LABEL,
  NOTIF_READINESS_BODY,
  NOTIF_READINESS_TITLE,
} from "@/lib/i18n/labels";
import { OA_ADD_FRIEND_URL, type NotificationReadiness } from "@/lib/notifications/readiness";

export function NotificationReadinessBanner({
  readiness,
}: {
  readiness: NotificationReadiness | null;
}) {
  if (readiness?.friendFlag !== false) return null;
  return (
    <div
      data-testid="notif-readiness-banner"
      className="border-attn bg-attn-soft flex items-start gap-3 rounded-xl border px-4 py-3"
    >
      <BellRing aria-hidden className="text-attn-ink mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-attn-ink text-body font-semibold">{NOTIF_READINESS_TITLE}</span>
        <span className="text-attn-ink text-meta">{NOTIF_READINESS_BODY}</span>
      </div>
      <a
        href={OA_ADD_FRIEND_URL}
        target="_blank"
        rel="noreferrer"
        aria-label={`${NOTIF_ADD_FRIEND_LABEL} — เปิดแอป LINE`}
        className="bg-fill text-on-fill text-meta min-h-11 shrink-0 self-center rounded-lg px-4 py-2 font-semibold"
      >
        {NOTIF_ADD_FRIEND_LABEL}
      </a>
    </div>
  );
}
