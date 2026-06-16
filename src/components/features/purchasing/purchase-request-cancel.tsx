"use client";

// Spec 67: the cancel action is guarded by the themed ConfirmDialog (via
// the shared ConfirmActionButton) — replaces the native window.confirm
// (§7) that this and the ship/attachment-remove buttons each hand-rolled.

import { cancelPurchaseRequest } from "@/app/requests/actions";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";

export function PurchaseRequestCancel({ requestId }: { requestId: string }) {
  return (
    <ConfirmActionButton
      idleLabel="ยกเลิกคำขอ"
      pendingLabel="กำลังยกเลิก…"
      confirmMessage="ยกเลิกคำขอซื้อนี้หรือไม่?"
      confirmLabel="ยืนยัน"
      buttonClassName="inline-flex h-11 items-center justify-center rounded-lg border border-edge-strong bg-card px-3 text-sm font-medium text-danger shadow-xs transition-colors hover:bg-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60"
      action={() => cancelPurchaseRequest({ id: requestId })}
    />
  );
}
