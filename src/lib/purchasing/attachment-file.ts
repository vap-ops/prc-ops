// Spec 121 / ADR 0046 Layer A — file classification for the pr-attachments
// write path. Today attachments are image-only (spec 23); this adds PDF as a
// first-class kind. PDFs are NOT downscaled (the spec-34 preparePhotoForUpload
// pipeline is photo-only) — the uploaders branch on these helpers to send raw
// bytes for a PDF and the canonical downscaled blob for a photo.
//
// Pure module — importable from client (uploaders) and server (the actions
// REBUILD the path + derive the kind themselves; client input is never trusted).

import {
  PHOTO_ACCEPT_MIME,
  isValidPhotoExt,
  photoExtToMime,
  type PhotoExt,
} from "@/lib/photos/path";

export const PDF_MIME = "application/pdf";

// The pr-attachments storage ext set: the photo exts (spec 34) plus pdf.
export type AttachmentExt = PhotoExt | "pdf";
// The DB `purchase_request_attachment_kind` values that carry stored bytes
// (vs 'link'). One kind per file type so the viewer dispatches on kind.
export type AttachmentFileKind = "image" | "pdf";

// <input accept> for the attachment uploaders: PHOTO_ACCEPT_MIME (the single
// source of truth for the photo mimes) plus application/pdf.
export const ATTACHMENT_ACCEPT_MIME = `${PHOTO_ACCEPT_MIME},${PDF_MIME}`;

export function isPdfMime(mime: string): boolean {
  return mime === PDF_MIME;
}

export function isValidAttachmentExt(value: unknown): value is AttachmentExt {
  return value === "pdf" || isValidPhotoExt(value);
}

export function attachmentKindForExt(ext: AttachmentExt): AttachmentFileKind {
  return ext === "pdf" ? "pdf" : "image";
}

// Upload contentType for a prepared attachment: raw application/pdf for a PDF,
// otherwise the photo's re-encoded mime (spec 34: a prepared photo is the ext
// the downscale produced, not the camera's original).
export function attachmentExtToMime(ext: AttachmentExt): string {
  return ext === "pdf" ? PDF_MIME : photoExtToMime(ext);
}
