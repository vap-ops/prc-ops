// Path conventions + input validators for the photo write path.
// Pure functions — safe to import from both server actions and client
// components (no server-only directive, no Supabase imports).
//
// Path shape (spec 03 decision 6, bucket migration header):
//   {project_id}/{work_package_id}/{photo_log_id}.{ext}
//
// `ext` is one of jpeg|png|webp|heic — matching the `photos` bucket's
// allowed_mime_types. The client derives ext from the file's MIME via
// mimeToPhotoExt() so file-name casing / aliases (.jpg → image/jpeg)
// can never produce a path the server would reject.

export const PHOTO_EXTS = ["jpeg", "png", "webp", "heic"] as const;
export type PhotoExt = (typeof PHOTO_EXTS)[number];

// Spec 65: the UUID validator moved to the domain-neutral
// src/lib/validate/uuid.ts; re-exported here so pre-spec-65 import sites
// keep working.
export { isValidUuid } from "@/lib/validate/uuid";

export function isValidPhotoExt(value: unknown): value is PhotoExt {
  return typeof value === "string" && (PHOTO_EXTS as readonly string[]).includes(value);
}

export function buildPhotoStoragePath(
  projectId: string,
  workPackageId: string,
  photoId: string,
  ext: PhotoExt,
): string {
  return `${projectId}/${workPackageId}/${photoId}.${ext}`;
}

export function mimeToPhotoExt(mime: string): PhotoExt | null {
  switch (mime) {
    case "image/jpeg":
      return "jpeg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    default:
      return null;
  }
}

// Inverse of mimeToPhotoExt — the upload contentType for a prepared
// photo (spec 34: a re-encoded photo is image/jpeg regardless of the
// camera's original MIME).
export function photoExtToMime(ext: PhotoExt): string {
  switch (ext) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
  }
}

// Spec 65: the <input accept> list the three photo uploaders previously
// hand-wrote. Derived so PHOTO_EXTS stays the single source of truth.
export const PHOTO_ACCEPT_MIME = PHOTO_EXTS.map(photoExtToMime).join(",");

// Feedback 10a15ebe — guarantee a blob carries the intended upload content-type.
// supabase-js sends the Blob's `.type` as the storage content-type and IGNORES the
// `.upload({ contentType })` option (verified against the deployed client); every
// bucket enforces allowed_mime_types for AUTHENTICATED uploads (service_role
// bypasses it). iOS Safari's `canvas.toBlob` — and an IndexedDB round-trip of a
// stored Blob — can yield a Blob whose `.type` is empty, which storage then treats
// as application/octet-stream and rejects with a 400 "mime type
// application/octet-stream is not supported". Wrapping normalizes the type without
// copying when it already matches. Bytes are preserved.
export function blobWithType(blob: Blob, mime: string): Blob {
  return blob.type === mime ? blob : new Blob([blob], { type: mime });
}
