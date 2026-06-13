"use client";

// Spec 67: the ship action is guarded by the themed ConfirmDialog (via the
// shared ConfirmActionButton) — replaces the native confirm sheet §7 forbids.

import { recordShipment } from "@/app/requests/actions";
import { ConfirmActionButton } from "@/components/features/confirm-action-button";

export function PurchaseRequestShip({ requestId }: { requestId: string }) {
  return (
    <ConfirmActionButton
      idleLabel="บันทึกว่าจัดส่งแล้ว"
      pendingLabel="กำลังบันทึก…"
      confirmMessage="บันทึกว่าของถูกจัดส่งแล้วหรือไม่?"
      confirmLabel="ยืนยัน"
      buttonClassName="inline-flex h-11 items-center justify-center rounded-md border border-slate-900 bg-white px-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      action={() => recordShipment({ requestId })}
    />
  );
}
