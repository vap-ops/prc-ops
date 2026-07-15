// Spec 323 U1d — canonical rental-settlement-receipt storage path:
//   {settlement_id}/{attachment_id}.{ext}
// Single-level folder — the bucket INSERT policy checks foldername depth = 1. Pure
// module: the client previews/builds the path to upload bytes, the server action
// REBUILDS it (a client-supplied path is never trusted).

import { isValidUuid } from "@/lib/photos/path";
import { isValidAttachmentExt, type AttachmentExt } from "@/lib/purchasing/attachment-file";

export function buildRentalReceiptPath(
  settlementId: string,
  attachmentId: string,
  ext: AttachmentExt,
): string | null {
  if (!isValidUuid(settlementId) || !isValidUuid(attachmentId)) return null;
  if (!isValidAttachmentExt(ext)) return null;
  return `${settlementId}/${attachmentId}.${ext}`;
}
