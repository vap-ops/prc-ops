// Spec 257 U1 — thumbnail + full-size signed-URL minting for the schedule
// calendar's photo strips. The bulk createSignedUrls (mintSignedUrls core)
// has no `transform` option, so thumbnails mint per-photo via the singular
// createSignedUrl; full-size URLs reuse the existing bulk core unchanged.
// Same 120s TTL, same private `photos` bucket, same exposure model (ADR
// 0015): inputs are photo_logs rows the caller already read under RLS.

import "server-only";

import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PHOTOS_BUCKET } from "@/lib/storage/buckets";

const SIGNED_URL_TTL_SECONDS = 120;
const THUMB_SIZE = 320;

export interface ThumbnailRow {
  id: string;
  storage_path: string | null;
}

export interface PhotoUrls {
  thumbUrl: string;
  fullUrl: string;
}

export async function mintPhotoThumbnails(
  rows: ReadonlyArray<ThumbnailRow>,
): Promise<Map<string, PhotoUrls>> {
  const withPath = rows.filter(
    (r): r is ThumbnailRow & { storage_path: string } => r.storage_path !== null,
  );
  if (withPath.length === 0) return new Map();

  const admin = createAdminClient();
  const [thumbResults, fullMap] = await Promise.all([
    Promise.all(
      withPath.map((r) =>
        admin.storage.from(PHOTOS_BUCKET).createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS, {
          transform: { width: THUMB_SIZE, height: THUMB_SIZE, resize: "contain" as const },
        }),
      ),
    ),
    mintSignedUrls(PHOTOS_BUCKET, withPath),
  ]);

  const result = new Map<string, PhotoUrls>();
  for (let i = 0; i < withPath.length; i++) {
    const row = withPath[i]!;
    const thumb = thumbResults[i];
    const fullUrl = fullMap.get(row.id);
    if (thumb?.error || !thumb?.data?.signedUrl || !fullUrl) continue;
    result.set(row.id, { thumbUrl: thumb.data.signedUrl, fullUrl });
  }
  return result;
}
