// Spec 125 / ADR 0046 Layer B — canonical po-attachments storage path:
//   {po_id}/{attachment_id}.{ext}
// A PO bundles tickets that can span projects, so the path is keyed on the
// po_id alone (the upload policy checks the PO exists). Pure module —
// importable from the create-PO sheet (client) and the action (server, which
// REBUILDS the path; a client-supplied path is never trusted). ext is one of
// the bucket's mime set — the photo exts plus pdf (spec 121).

import { isValidUuid } from "@/lib/photos/path";
import { isValidAttachmentExt, type AttachmentExt } from "@/lib/purchasing/attachment-file";

export function buildPoAttachmentStoragePath(
  purchaseOrderId: string,
  attachmentId: string,
  ext: AttachmentExt,
): string | null {
  if (!isValidUuid(purchaseOrderId) || !isValidUuid(attachmentId)) {
    return null;
  }
  if (!isValidAttachmentExt(ext)) {
    return null;
  }
  return `${purchaseOrderId}/${attachmentId}.${ext}`;
}
