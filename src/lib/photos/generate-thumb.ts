// Spec 398 U1 — generate one stored thumbnail for one photo object.
//
// The whole environment is injected (download / resize / upload) so the control flow
// is unit-testable without sharp, Storage, or the network. `defaultThumbDeps()` is the
// wiring seam and imports sharp LAZILY, so a test that only exercises the flow never
// pays for libvips.
//
// NEVER throws: a photo whose thumbnail cannot be produced still renders at full size
// (spec 398 D4), so a failure here must not take down the request that scheduled it.

import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { PHOTOS_BUCKET } from "@/lib/storage/buckets";
import { thumbKeyFor, THUMB_SIZE } from "@/lib/photos/thumb-key";

// The optional members carry an explicit `| undefined` because the repo compiles with
// `exactOptionalPropertyTypes`: supabase-js types StorageError.statusCode as
// `string | undefined`, which is NOT assignable to a bare `statusCode?: string | number`.
export interface StorageErrorLike {
  statusCode?: string | number | undefined;
  message?: string | undefined;
}

export interface ThumbDeps {
  download(key: string): Promise<{ bytes: Buffer | null; error: StorageErrorLike | null }>;
  resize(input: Buffer): Promise<Buffer>;
  upload(key: string, bytes: Buffer): Promise<{ error: StorageErrorLike | null }>;
}

export type ThumbOutcome =
  | { status: "created"; key: string }
  /** The object was already there — a concurrent render or a re-run of the backfill.
   *  `upsert: false` makes that a 409, which is SUCCESS for our purposes (the same
   *  idempotence shape the offline upload queue relies on). */
  | { status: "exists"; key: string }
  | { status: "failed"; reason: string };

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function generatePhotoThumb(
  storagePath: string,
  deps: ThumbDeps,
): Promise<ThumbOutcome> {
  let key: string;
  try {
    key = thumbKeyFor(storagePath);
  } catch (e) {
    return { status: "failed", reason: reasonOf(e) };
  }

  try {
    const downloaded = await deps.download(storagePath);
    if (downloaded.error || !downloaded.bytes) {
      return {
        status: "failed",
        reason: downloaded.error?.message ?? "download returned no bytes",
      };
    }

    const resized = await deps.resize(downloaded.bytes);

    const uploaded = await deps.upload(key, resized);
    if (uploaded.error) {
      if (classifyStorageUploadError(uploaded.error).alreadyExists) {
        return { status: "exists", key };
      }
      return { status: "failed", reason: uploaded.error.message ?? "upload failed" };
    }

    return { status: "created", key };
  } catch (e) {
    return { status: "failed", reason: reasonOf(e) };
  }
}

/** The wiring seam: real Storage + real sharp. Untested by design (three lines of
 *  plumbing); everything that can be wrong lives in generatePhotoThumb above. */
export function defaultThumbDeps(admin: {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: StorageErrorLike | null }>;
      upload(
        path: string,
        body: Buffer,
        opts: { upsert: boolean; contentType: string },
      ): Promise<{ error: StorageErrorLike | null }>;
    };
  };
}): ThumbDeps {
  const bucket = admin.storage.from(PHOTOS_BUCKET);
  return {
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) return { bytes: null, error: error ?? { message: "no data" } };
      return { bytes: Buffer.from(await data.arrayBuffer()), error: null };
    },
    async resize(input) {
      const { default: sharp } = await import("sharp");
      // ⚠️ HEIC does not decode in this build and cannot be made to: the prebuilt
      // libheif ships without an HEVC decoder ("Support for this compression format
      // has not been built in"). Measured on the real bucket — all 10 .heic originals
      // fail, with or without `unlimited: true` (that flag only clears the separate
      // iloc security limit, so it was tried and reverted). Those photos fall back to
      // full size per D4; see spec 398 §5.
      return sharp(input)
        .rotate() // honour EXIF orientation before resizing, or a portrait photo thumbs sideways
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
    },
    upload(key, bytes) {
      return bucket.upload(key, bytes, { upsert: false, contentType: "image/webp" });
    },
  };
}
