// Canonical pr-attachments storage path (spec 23 / spec 16 §4):
//   {project_id}/{purchase_request_id}/{attachment_id}.{ext}
// Pure module — importable from client (path preview) and server (the
// action REBUILDS the path itself; a client-supplied path is never
// trusted). Reuses the photo path validators — same bucket mime set.

import { isValidPhotoExt, isValidUuid, type PhotoExt } from "@/lib/photos/path";

export function buildPrAttachmentStoragePath(
  projectId: string,
  purchaseRequestId: string,
  attachmentId: string,
  ext: PhotoExt,
): string | null {
  if (!isValidUuid(projectId) || !isValidUuid(purchaseRequestId) || !isValidUuid(attachmentId)) {
    return null;
  }
  if (!isValidPhotoExt(ext)) {
    return null;
  }
  return `${projectId}/${purchaseRequestId}/${attachmentId}.${ext}`;
}
