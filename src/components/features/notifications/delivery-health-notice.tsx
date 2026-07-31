// Spec 387 U2 — "the pipeline has stopped delivering" notice.
//
// Presentational and silent by default: renders NOTHING unless the reader
// actually found failures. A probe that could not run returns null upstream and
// lands here as null too — an always-on health nag is worse than the silence it
// replaces (the spec 339 U2b lesson).
//
// Honest copy: this is NOT retryable by whoever is reading it. A LINE quota or a
// missing channel token is fixed at the source, so the notice says so instead of
// offering a "ลองใหม่" that cannot work.

import { AlertTriangle } from "lucide-react";
import type { DeliveryHealth } from "@/lib/notifications/delivery-health";
import {
  NOTIF_HEALTH_ACTION,
  NOTIF_HEALTH_CAUSE_LABEL,
  NOTIF_HEALTH_TITLE,
  notifHealthBody,
} from "@/lib/i18n/labels";

export function NotificationDeliveryHealthNotice({ health }: { health: DeliveryHealth | null }) {
  if (!health?.degraded) return null;
  return (
    <div
      role="alert"
      data-testid="notif-delivery-health"
      className="border-attn bg-attn-soft flex items-start gap-3 rounded-xl border px-4 py-3"
    >
      <AlertTriangle aria-hidden className="text-attn-ink mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-attn-ink text-body font-semibold">{NOTIF_HEALTH_TITLE}</span>
        <span className="text-attn-ink text-meta">
          {notifHealthBody(health.failed, health.terminal, health.windowDays)}
        </span>
        {health.lastError ? (
          <span className="text-attn-ink text-meta min-w-0 break-words opacity-90">
            {NOTIF_HEALTH_CAUSE_LABEL}: {health.lastError}
          </span>
        ) : null}
        <span className="text-attn-ink text-meta opacity-90">{NOTIF_HEALTH_ACTION}</span>
      </div>
    </div>
  );
}
