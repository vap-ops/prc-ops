"use client";

// Spec 318 U4 — send a plain test push to the caller's own LINE (spec-212
// sample-push precedent). Inline pending/sent/error, mirroring the app's other
// action buttons.

import { useState, useTransition } from "react";
import { sendTestNotification } from "@/app/settings/notifications/actions";
import { NOTIF_TEST_BUTTON, NOTIF_TEST_SENT } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";

export function TestNotificationButton() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const result = await sendTestNotification();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={send} disabled={pending} className={BUTTON_SECONDARY}>
        {pending ? "กำลังส่ง…" : NOTIF_TEST_BUTTON}
      </button>
      {sent ? (
        <p role="status" className="text-done-strong text-meta font-medium">
          {NOTIF_TEST_SENT}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
