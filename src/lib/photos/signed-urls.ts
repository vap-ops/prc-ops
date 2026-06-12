// Server-side signed-URL minting for the private `photos` bucket, per
// ADR 0015 / feature spec 03. Since spec 65 the implementation is the
// generic core in src/lib/storage/signed-urls.ts (shared with the
// pr-attachments wrapper); this module keeps the typed photo surface.
//
// Inputs are photo_logs rows the caller already read under the user's
// RLS context. Tombstones (storage_path NULL) are skipped.

import "server-only";

import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PHOTOS_BUCKET } from "@/lib/storage/buckets";
import type { PhotoLogRow } from "./current-photos";

export async function mintSignedUrlsForPhotos(
  photos: ReadonlyArray<PhotoLogRow>,
): Promise<Map<string, string>> {
  return mintSignedUrls(PHOTOS_BUCKET, photos);
}
