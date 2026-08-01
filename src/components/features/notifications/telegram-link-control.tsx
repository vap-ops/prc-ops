"use client";

// Spec 386 U3 — the self-serve Telegram bind/unbind row on /settings/notifications.
//
// Before this, the page rendered NOTIF_TELEGRAM_ROW only when already linked, so
// 39 of 40 users were shown nothing at all — no status, no affordance, no
// explanation (§1.3). The office tier cannot be reached by LINE at all (§1.2),
// which makes this row their only route to being notified.

import { useState, useTransition } from "react";

import { startTelegramLink, unlinkTelegram } from "@/app/settings/notifications/actions";
import {
  NOTIF_TELEGRAM_BIND_BUTTON,
  NOTIF_TELEGRAM_BIND_HINT,
  NOTIF_TELEGRAM_BIND_PENDING,
  NOTIF_TELEGRAM_NOT_CONFIGURED,
  NOTIF_TELEGRAM_PRIVACY_HINT,
  NOTIF_TELEGRAM_ROW,
  NOTIF_TELEGRAM_UNLINK_BUTTON,
  NOTIF_TELEGRAM_UNLINK_PENDING,
  NOTIF_TELEGRAM_UNLINKED_ROW,
} from "@/lib/i18n/labels";
import { BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";

export function TelegramLinkControl({
  linked,
  botConfigured,
}: {
  linked: boolean;
  botConfigured: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function bind() {
    setError(null);
    startTransition(async () => {
      const result = await startTelegramLink();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Same-tab navigation, deliberately NOT window.open: a popup opened after
      // an await is blocked on iOS Safari, which is most of this audience. The
      // t.me link hands off to the Telegram app when it is installed.
      window.location.href = result.url;
    });
  }

  function unbind() {
    setError(null);
    startTransition(async () => {
      const result = await unlinkTelegram();
      if (!result.ok) setError(result.error);
      // Success needs no local state: the action revalidates the page, which
      // re-renders this row from the freshly-read users row.
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-meta">{linked ? NOTIF_TELEGRAM_ROW : NOTIF_TELEGRAM_UNLINKED_ROW}</p>
        {linked ? (
          <button
            type="button"
            onClick={unbind}
            disabled={pending}
            className={`${BUTTON_SECONDARY} shrink-0`}
          >
            {pending ? NOTIF_TELEGRAM_UNLINK_PENDING : NOTIF_TELEGRAM_UNLINK_BUTTON}
          </button>
        ) : botConfigured ? (
          <button
            type="button"
            onClick={bind}
            disabled={pending}
            className={`${BUTTON_SECONDARY} shrink-0`}
          >
            {pending ? NOTIF_TELEGRAM_BIND_PENDING : NOTIF_TELEGRAM_BIND_BUTTON}
          </button>
        ) : null}
      </div>

      {/* Honest copy: with no bot configured, binding cannot work — so say so
          rather than offering a button that refuses. Mirrors the U5 roster. */}
      {!linked && !botConfigured ? (
        <p className="text-ink-secondary text-meta">{NOTIF_TELEGRAM_NOT_CONFIGURED}</p>
      ) : null}

      {/* The PDPA notice belongs at the point of collection (§7), so it renders
          BEFORE the tap that stores the chat id — not only once already bound. */}
      {!linked && botConfigured ? (
        <>
          <p className="text-ink-secondary text-meta">{NOTIF_TELEGRAM_BIND_HINT}</p>
          <p className="text-ink-secondary text-meta">{NOTIF_TELEGRAM_PRIVACY_HINT}</p>
        </>
      ) : null}

      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
