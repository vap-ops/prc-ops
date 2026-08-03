"use client";

// Spec 390 U2 — the per-CHANNEL switches on /settings/notifications.
//
// One switch per channel the caller has BOUND (an unbound channel has nothing to
// switch). A switch the floor cannot let them turn off renders on + inoperable
// with a hint naming the REAL reason — mirroring the locked-entry shape in
// preferences-form.tsx, which is `aria-disabled` plus an early-return handler
// guard, NOT the HTML `disabled` attribute.
//
// `use client` justification (CLAUDE.md): this is an optimistic toggle with
// rollback, identical in kind to the per-event form beside it. A server
// round-trip per tap would put a network hop between the tap and the switch
// moving, on the worst connection the app has to survive.

import { useState, useTransition } from "react";
import { saveNotificationChannelPreference } from "@/app/settings/notifications/actions";
import {
  canSetChannel,
  NOTIFICATION_CHANNELS,
  type ChannelBindingInput,
  type NotificationChannel,
} from "@/lib/notifications/channel-preference-filter";
import {
  NOTIF_CHANNEL_GROUP_HEADING,
  NOTIF_CHANNEL_GROUP_HINT,
  NOTIF_CHANNEL_LAST_ONE_HINT,
  NOTIF_CHANNEL_LINE,
  NOTIF_CHANNEL_LINE_UNREACHABLE_HINT,
  NOTIF_CHANNEL_NONE_BOUND,
  NOTIF_CHANNEL_TELEGRAM,
} from "@/lib/i18n/labels";
import { GROUP_CARD } from "@/app/settings/section-card";
import { INLINE_ERROR } from "@/lib/ui/classes";

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  line: NOTIF_CHANNEL_LINE,
  telegram: NOTIF_CHANNEL_TELEGRAM,
};

export function NotificationChannelForm({
  lineBound,
  lineFriendFlag,
  telegramBound,
  disabledChannels,
}: {
  lineBound: boolean;
  lineFriendFlag: boolean | null;
  telegramBound: boolean;
  disabledChannels: readonly NotificationChannel[];
}) {
  const [disabled, setDisabled] = useState<Set<NotificationChannel>>(new Set(disabledChannels));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<NotificationChannel | null>(null);
  const [, startTransition] = useTransition();

  const bindingOf = (next: Set<NotificationChannel>): ChannelBindingInput => ({
    lineBound,
    lineFriendFlag,
    telegramBound,
    disabled: next,
  });

  const boundChannels = NOTIFICATION_CHANNELS.filter((c) =>
    c === "line" ? lineBound : telegramBound,
  );

  function toggle(channel: NotificationChannel) {
    if (busy === channel) return; // ignore a re-tap mid-flight
    const nextEnabled = disabled.has(channel); // currently off → turning ON
    // The floor only ever applies to a disable; canSetChannel encodes that so an
    // enable can never be blocked (a user who turned everything off must still
    // be able to turn something back on).
    if (!canSetChannel(bindingOf(disabled), channel, nextEnabled)) return;

    setError(null);
    setDisabled((prev) => {
      const next = new Set(prev);
      if (nextEnabled) next.delete(channel);
      else next.add(channel);
      return next;
    });
    setBusy(channel);
    startTransition(async () => {
      const result = await saveNotificationChannelPreference(channel, nextEnabled);
      if (!result.ok) {
        setDisabled((prev) => {
          const next = new Set(prev);
          if (nextEnabled) next.add(channel);
          else next.delete(channel);
          return next;
        });
        setError(result.error);
      }
      setBusy(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-meta text-ink-secondary font-semibold">{NOTIF_CHANNEL_GROUP_HEADING}</h2>
      {boundChannels.length === 0 ? (
        <div className={`${GROUP_CARD} border px-4 py-3`}>
          <p className="text-ink-secondary text-meta">{NOTIF_CHANNEL_NONE_BOUND}</p>
        </div>
      ) : (
        <>
          <p className="text-ink-secondary text-meta">{NOTIF_CHANNEL_GROUP_HINT}</p>
          {error ? (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          ) : null}
          <div className={`${GROUP_CARD} divide-edge divide-y border`}>
            {boundChannels.map((channel) => {
              const on = !disabled.has(channel);
              // Inoperable only when it is ON and the floor forbids turning it
              // off. An OFF switch is always operable — turning it back on is
              // never blocked.
              const locked = on && !canSetChannel(bindingOf(disabled), channel, false);
              const lineUnreachable = channel === "line" && lineFriendFlag === false;
              const hint = locked
                ? NOTIF_CHANNEL_LAST_ONE_HINT
                : lineUnreachable
                  ? NOTIF_CHANNEL_LINE_UNREACHABLE_HINT
                  : null;
              return (
                <div key={channel} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-ink text-body font-medium">{CHANNEL_LABEL[channel]}</span>
                    {hint ? <span className="text-ink-secondary text-meta">{hint}</span> : null}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-disabled={locked}
                    aria-label={CHANNEL_LABEL[channel]}
                    onClick={() => toggle(channel)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      on ? "bg-fill" : "bg-edge-strong"
                    } ${locked ? "opacity-60" : ""}`}
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
        </>
      )}
    </div>
  );
}
