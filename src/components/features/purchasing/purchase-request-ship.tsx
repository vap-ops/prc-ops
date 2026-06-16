"use client";

// Spec 67: the ship action is guarded by the themed ConfirmDialog (via the
// shared ConfirmActionButton) — replaces the native confirm sheet §7 forbids.

import { recordShipment } from "@/app/requests/actions";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";

export function PurchaseRequestShip({ requestId }: { requestId: string }) {
  return (
    <ConfirmActionButton
      idleLabel="บันทึกว่าจัดส่งแล้ว"
      pendingLabel="กำลังบันทึก…"
      confirmMessage="บันทึกว่าของถูกจัดส่งแล้วหรือไม่?"
      confirmLabel="ยืนยัน"
      buttonClassName="inline-flex h-11 items-center justify-center rounded-md border border-fill bg-card px-3 text-sm font-medium text-ink transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-60"
      action={() => recordShipment({ requestId })}
    />
  );
}
