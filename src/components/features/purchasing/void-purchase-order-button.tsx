"use client";

// Spec 259 / amends ADR 0038 — undo a mistakenly-created PO. Mirrors
// PurchaseRequestCancel's ConfirmActionButton pattern; the page only renders
// this when canManage && canVoidPurchaseOrder(members) (server-side, mirrors
// the RPC's own all-purchased guard) — the RPC re-checks everything anyway.

import { useRouter } from "next/navigation";
import { voidPurchaseOrder } from "@/app/requests/actions";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";

export function VoidPurchaseOrderButton({
  purchaseOrderId,
  poNumber,
}: {
  purchaseOrderId: string;
  poNumber: number;
}) {
  const router = useRouter();

  return (
    <ConfirmActionButton
      idleLabel="ยกเลิกใบสั่งซื้อ"
      pendingLabel="กำลังยกเลิก…"
      confirmMessage={`ยกเลิกใบสั่งซื้อ #${poNumber} หรือไม่? รายการทั้งหมดจะกลับไปอยู่ในสถานะอนุมัติ พร้อมนำไปสร้างใบสั่งซื้อใหม่ได้`}
      confirmLabel="ยืนยันยกเลิก"
      buttonClassName="inline-flex h-11 items-center justify-center rounded-lg border border-edge-strong bg-card px-3 text-sm font-medium text-danger shadow-xs transition-colors hover:bg-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60"
      action={async () => {
        const result = await voidPurchaseOrder({ poId: purchaseOrderId });
        if (result.ok) {
          router.push("/requests");
        }
        return result;
      }}
    />
  );
}
