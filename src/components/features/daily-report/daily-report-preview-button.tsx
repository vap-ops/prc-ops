"use client";

// Spec 212 — settings button (super_admin) that sends the sample daily report to
// the caller's own LINE, to preview the real Flex bubble. Client: useTransition +
// inline pending/sent/error, mirroring the app's other action buttons.

import { useState, useTransition } from "react";
import { sendDailyReportPreviewToSelf } from "@/app/settings/actions";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";

export function DailyReportPreviewButton() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const result = await sendDailyReportPreviewToSelf();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={send} disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "กำลังส่ง…" : "ส่งรายงานตัวอย่างเข้า LINE ของฉัน"}
      </button>
      {sent ? (
        <p role="status" className="text-done-strong text-sm font-medium">
          ส่งแล้ว — เปิด LINE เพื่อดูตัวอย่างรายงาน
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
