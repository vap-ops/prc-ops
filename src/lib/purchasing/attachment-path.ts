// Canonical pr-attachments storage path (spec 23 / spec 16 §4):
//   {project_id}/{purchase_request_id}/{attachment_id}.{ext}
// Pure module — importable from client (path preview) and server (the
// action REBUILDS the path itself; a client-supplied path is never
// trusted). ext is one of the bucket's mime set — the photo exts plus pdf
// (spec 121 / ADR 0046 Layer A).

import { isValidUuid } from "@/lib/photos/path";
import { isValidAttachmentExt, type AttachmentExt } from "@/lib/purchasing/attachment-file";

export function buildPrAttachmentStoragePath(
  projectId: string,
  purchaseRequestId: string,
  attachmentId: string,
  ext: AttachmentExt,
): string | null {
  if (!isValidUuid(projectId) || !isValidUuid(purchaseRequestId) || !isValidUuid(attachmentId)) {
    return null;
  }
  if (!isValidAttachmentExt(ext)) {
    return null;
  }
  return `${projectId}/${purchaseRequestId}/${attachmentId}.${ext}`;
}
