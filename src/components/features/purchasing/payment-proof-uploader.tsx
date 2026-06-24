"use client";

// Procurement bug 2 — the proof-of-payment (สลิปโอน / หลักฐานการชำระเงิน)
// uploader. The buyer's payment slip, distinct from the supplier's invoice/
// receipt. Reuses InvoiceUploader's upload state machine (same pr-attachments
// bucket + path + idempotent landing) with the payment action + label.

import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { addPaymentProofAttachment } from "@/app/requests/actions";

export function PaymentProofUploader({
  purchaseRequestId,
  projectId,
}: {
  purchaseRequestId: string;
  projectId: string;
}) {
  return (
    <InvoiceUploader
      purchaseRequestId={purchaseRequestId}
      projectId={projectId}
      action={addPaymentProofAttachment}
      label="แนบหลักฐานการชำระเงิน"
    />
  );
}
