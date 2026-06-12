"use client";

// 'use client' justification (spec 27): window.confirm + pending state
// around the cancel server action — same shape as AttachmentRemoveButton.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelPurchaseRequest } from "@/app/requests/actions";
import { INLINE_ALERT_TEXT } from "@/lib/ui/classes";

interface PurchaseRequestCancelProps {
  requestId: string;
}

export function PurchaseRequestCancel({ requestId }: PurchaseRequestCancelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCancel() {
    if (!window.confirm("ยกเลิกคำขอซื้อนี้หรือไม่?")) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelPurchaseRequest({ id: requestId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleCancel}
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-red-700 shadow-xs transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "กำลังยกเลิก…" : "ยกเลิกคำขอ"}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
