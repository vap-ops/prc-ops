"use client";

// Spec 211 U11b — the item-photo uploader for a self-purchase (รูปสินค้า): a
// picture of WHAT was bought, distinct from the receipt/invoice docs. Reuses
// InvoiceUploader's upload state machine (same pr-attachments bucket + path +
// idempotent landing) with the reference action + label.

import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { addReferenceAttachment } from "@/app/requests/actions";

export function ItemPhotoUploader({
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
      action={addReferenceAttachment}
      label="แนบรูปสินค้า"
    />
  );
}
