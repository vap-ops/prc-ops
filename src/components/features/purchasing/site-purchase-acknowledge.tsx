"use client";

// Spec 66 / ADR 0043 — PM/super acknowledges an on-site purchase. Benign
// (non-destructive) action, so a plain button + transition, not the red
// ConfirmDialog. The amber "awaiting acknowledgement" badge is server-
// derived from source='site_purchase' + acknowledged_at; this is only the
// action affordance, rendered for deciders on an unacknowledged row.
//
// 'use client' justified: action call + pending state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeSitePurchase } from "@/app/requests/actions";
import { BUTTON_PRIMARY, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function SitePurchaseAcknowledge({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function acknowledge() {
    setError(null);
    startTransition(async () => {
      const result = await acknowledgeSitePurchase(requestId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={acknowledge} disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "กำลังบันทึก…" : "รับทราบการซื้อหน้างาน"}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
