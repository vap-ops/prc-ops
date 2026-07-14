// Canonical expense-attachments storage path (spec 310 U4):
//   {office_expense_id}/{attachment_id}.{ext}
// Single-level folder — the bucket INSERT policy checks foldername depth = 1.
// Pure module: the client previews/builds the path to upload bytes, the server
// action REBUILDS it (a client-supplied path is never trusted).

import { isValidUuid } from "@/lib/photos/path";
import { isValidAttachmentExt, type AttachmentExt } from "@/lib/purchasing/attachment-file";

export function buildExpenseAttachmentPath(
  officeExpenseId: string,
  attachmentId: string,
  ext: AttachmentExt,
): string | null {
  if (!isValidUuid(officeExpenseId) || !isValidUuid(attachmentId)) return null;
  if (!isValidAttachmentExt(ext)) return null;
  return `${officeExpenseId}/${attachmentId}.${ext}`;
}
