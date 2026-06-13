"use client";

// Spec 67: the attachment-remove (tombstone) action is guarded by the
// themed ConfirmDialog (via the shared ConfirmActionButton) — replaces the
// native confirm sheet §7 forbids. Rendered under a photo tile, so the
// trigger stays the small red "ลบ" link.

import { removePurchaseRequestAttachment } from "@/app/requests/actions";
import { ConfirmActionButton } from "@/components/features/confirm-action-button";

export function AttachmentRemoveButton({ attachmentId }: { attachmentId: string }) {
  return (
    <ConfirmActionButton
      idleLabel="ลบ"
      pendingLabel="กำลังลบ…"
      confirmMessage="ลบรายการแนบนี้หรือไม่?"
      confirmLabel="ลบ"
      buttonClassName="text-xs font-medium text-red-700 underline-offset-2 hover:underline focus:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:opacity-60"
      action={() => removePurchaseRequestAttachment({ attachmentId })}
    />
  );
}
