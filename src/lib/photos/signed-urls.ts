// Server-side helper that mints short-lived signed URLs against the
// private `photos` Storage bucket, per ADR 0015 / feature spec 03.
//
// Reads are NOT covered by a storage.objects SELECT RLS policy — the
// bucket migration intentionally left SELECT unpolicied so reads only
// happen via service-role-minted signed URLs. The application-layer
// authorisation is the photo_logs SELECT RLS the caller has already
// passed (this helper is invoked from role-gated Server Components).
//
// Inputs are photo_logs rows the caller already read. Tombstones
// (storage_path NULL) are skipped — they have nothing to sign for.

import "server-only";

import { createClient as createAdminClient } from "@/lib/db/admin";
import type { PhotoLogRow } from "./current-photos";

// 120 seconds: middle of the 60–300s window the spec specifies. Long
// enough for the page to load and the browser to fetch every thumbnail;
// short enough that a leaked URL has very little value.
const SIGNED_URL_TTL_SECONDS = 120;

const PHOTOS_BUCKET = "photos";

export async function mintSignedUrlsForPhotos(
  photos: ReadonlyArray<PhotoLogRow>,
): Promise<Map<string, string>> {
  const withPath = photos.filter(
    (p): p is PhotoLogRow & { storage_path: string } => p.storage_path !== null,
  );
  if (withPath.length === 0) return new Map();

  const admin = createAdminClient();
  const paths = withPath.map((p) => p.storage_path);
  const { data, error } = await admin.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;

  const result = new Map<string, string>();
  for (let i = 0; i < withPath.length; i++) {
    const photo = withPath[i]!;
    const entry = data?.[i];
    if (entry && !entry.error && entry.signedUrl) {
      result.set(photo.id, entry.signedUrl);
    }
  }
  return result;
}
