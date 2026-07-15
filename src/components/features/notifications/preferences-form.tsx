"use client";

// Spec 318 U4 — the /settings/notifications toggle list. One switch per catalog
// entry the caller can receive; absence of a mute row = ON. A locked entry
// (safety alerts) renders on + disabled with a hint and never calls the action.
// Optimistic flip with rollback on failure (useTransition), mirroring the app's
// other inline-action controls.

import { useState, useTransition } from "react";
import { saveNotificationPreference } from "@/app/settings/notifications/actions";
import {
  NOTIFICATION_CATEGORY_LABEL,
  NOTIFICATION_CATEGORY_ORDER,
  type NotificationToggleEntry,
  type NotificationEventType,
} from "@/lib/notifications/notification-catalog";
import { NOTIF_LOCKED_HINT } from "@/lib/i18n/labels";
import { GROUP_CARD } from "@/app/settings/section-card";
import { INLINE_ERROR } from "@/lib/ui/classes";

export function NotificationPreferencesForm({
  entries,
  mutedEvents,
}: {
  entries: readonly NotificationToggleEntry[];
  mutedEvents: readonly NotificationEventType[];
}) {
  const [muted, setMuted] = useState<Set<NotificationEventType>>(new Set(mutedEvents));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<NotificationEventType | null>(null);
  const [, startTransition] = useTransition();

  function toggle(entry: NotificationToggleEntry) {
    if (entry.locked || busy === entry.event) return; // ignore a re-tap mid-flight
    const nextEnabled = muted.has(entry.event); // muted → turning ON
    setError(null);
    setMuted((prev) => {
      const next = new Set(prev);
      if (nextEnabled) next.delete(entry.event);
      else next.add(entry.event);
      return next;
    });
    setBusy(entry.event);
    startTransition(async () => {
      const result = await saveNotificationPreference(entry.event, nextEnabled);
      if (!result.ok) {
        // rollback the optimistic flip
        setMuted((prev) => {
          const next = new Set(prev);
          if (nextEnabled) next.add(entry.event);
          else next.delete(entry.event);
          return next;
        });
        setError(result.error);
      }
      setBusy(null);
    });
  }

  const byCategory = NOTIFICATION_CATEGORY_ORDER.map((cat) => ({
    cat,
    rows: entries.filter((e) => e.category === cat),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
      {byCategory.map(({ cat, rows }) => (
        <div key={cat} className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">
            {NOTIFICATION_CATEGORY_LABEL[cat]}
          </h2>
          <div className={`${GROUP_CARD} divide-edge divide-y border`}>
            {rows.map((entry) => {
              const on = entry.locked || !muted.has(entry.event);
              return (
                <div key={entry.event} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-ink text-body font-medium">{entry.label}</span>
                    <span className="text-ink-secondary text-meta">
                      {entry.locked ? NOTIF_LOCKED_HINT : entry.description}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-disabled={entry.locked}
                    aria-label={entry.label}
                    onClick={() => toggle(entry)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      on ? "bg-fill" : "bg-edge-strong"
                    } ${entry.locked ? "opacity-60" : ""}`}
                  >
                    <span
                      aria-hidden
                      className={`bg-card absolute top-0.5 h-5 w-5 rounded-full transition-transform ${
                        on ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
