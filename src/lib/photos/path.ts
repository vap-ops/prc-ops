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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidPhotoExt(value: unknown): value is PhotoExt {
  return typeof value === "string" && (PHOTO_EXTS as readonly string[]).includes(value);
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
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
