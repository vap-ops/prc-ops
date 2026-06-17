"use client";

// Spec 135 U6 / ADR 0054 — record that a delivery (งวด) is on its way. Marks its
// purchased lines shipped → on_route, so the PO advances ordered (สั่งซื้อแล้ว) →
// in_transit (กำลังจัดส่ง). Back-office only (rendered behind the page's gate); shown
// when the งวด still has purchased (un-dispatched) lines.
//
// 'use client' justified: submit + transition state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dispatchPurchaseOrderDelivery } from "@/app/requests/actions";
import { BUTTON_PRIMARY, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function DeliveryDispatchControl({
  deliveryId,
  count,
}: {
  deliveryId: string;
  count: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await dispatchPurchaseOrderDelivery(deliveryId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-ink-secondary text-xs">
        ทำเครื่องหมายว่างวดนี้กำลังจัดส่ง ({count} รายการ)
      </p>
      <button type="button" onClick={submit} disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "กำลังบันทึก…" : "บันทึกการจัดส่ง"}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
