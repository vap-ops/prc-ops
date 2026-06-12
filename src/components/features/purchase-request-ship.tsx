"use client";

// 'use client' justification (spec 33): window.confirm + pending state
// around the record_shipment action — PurchaseRequestCancel pattern.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordShipment } from "@/app/requests/actions";
import { INLINE_ALERT_TEXT } from "@/lib/ui/classes";

interface PurchaseRequestShipProps {
  requestId: string;
}

export function PurchaseRequestShip({ requestId }: PurchaseRequestShipProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleShip() {
    if (!window.confirm("บันทึกว่าของถูกจัดส่งแล้วหรือไม่?")) return;
    setError(null);
    startTransition(async () => {
      const result = await recordShipment({ requestId });
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
        onClick={handleShip}
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-md border border-slate-900 bg-white px-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "กำลังบันทึก…" : "บันทึกว่าจัดส่งแล้ว"}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
