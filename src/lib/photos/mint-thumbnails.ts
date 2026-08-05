// Spec 398 U3 — thumbnail + full-size signed-URL minting for the schedule calendar's
// photo strips and the WP-catalogue reference section.
//
// SUPERSEDES spec 257 U1's transform-based minting. Thumbnails are now STORED objects
// at a derived key in the same private `photos` bucket (spec 398 D2/D3), so both URL
// sets come from the bulk createSignedUrls core and the Storage image-transformation
// API is not called at all. It was: 257 minted a `transform:{320,320,contain}` URL per
// photo, that API is metered at 100 ORIGIN IMAGES per billing cycle, and the org sat at
// 689% of it with the spend cap on.
//
// Same 120s TTL, same private bucket, same exposure model (ADR 0015): inputs are
// photo_logs rows the caller already read under RLS.

import "server-only";

import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PHOTOS_BUCKET } from "@/lib/storage/buckets";
import { thumbKeyFor } from "@/lib/photos/thumb-key";

const SIGNED_URL_TTL_SECONDS = 120;

export interface ThumbnailRow {
  id: string;
  storage_path: string | null;
}

export interface PhotoUrls {
  thumbUrl: string;
  fullUrl: string;
}

/** Signed URLs for the STORED thumbnails, keyed by the ORIGINAL object path.
 *  A miss is normal (a photo whose thumbnail has not been generated yet) and
 *  non-fatal — the caller falls back to full size. */
async function mintStoredThumbUrls(paths: ReadonlyArray<string>): Promise<Map<string, string>> {
  // [thumbKey, originalPath]. A path no key can be derived from (non-ASCII) is simply
  // absent from the batch and falls back, rather than throwing the whole strip away.
  const pairs: Array<[string, string]> = [];
  for (const path of paths) {
    try {
      pairs.push([thumbKeyFor(path), path]);
    } catch {
      continue;
    }
  }
  if (pairs.length === 0) return new Map();

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(PHOTOS_BUCKET).createSignedUrls(
    pairs.map(([key]) => key),
    SIGNED_URL_TTL_SECONDS,
  );
  // A storage-wide failure degrades the whole batch to full-size images. Deliberately
  // not thrown: a slower strip beats an empty one.
  if (error || !data) return new Map();

  const byOriginalPath = new Map<string, string>();
  for (let i = 0; i < pairs.length; i++) {
    const entry = data[i];
    if (entry && !entry.error && entry.signedUrl) {
      byOriginalPath.set(pairs[i]![1], entry.signedUrl);
    }
  }
  return byOriginalPath;
}

export async function mintPhotoThumbnails(
  rows: ReadonlyArray<ThumbnailRow>,
): Promise<Map<string, PhotoUrls>> {
  const withPath = rows.filter(
    (r): r is ThumbnailRow & { storage_path: string } => r.storage_path !== null,
  );
  if (withPath.length === 0) return new Map();

  const [thumbByPath, fullMap] = await Promise.all([
    mintStoredThumbUrls(withPath.map((r) => r.storage_path)),
    mintSignedUrls(PHOTOS_BUCKET, withPath),
  ]);

  const result = new Map<string, PhotoUrls>();
  for (const row of withPath) {
    const fullUrl = fullMap.get(row.id);
    // No full-size URL means the object itself is unreachable — nothing to show and
    // nothing to fall back to, so the callers' drop is correct in this case only.
    if (!fullUrl) continue;
    // Spec 398 D4: a missing thumbnail degrades to the full-size image, NEVER to a
    // dropped photo — both callers discard a row that has no URL
    // (schedule/actions.ts `if (!url) continue`, reference-photo-section.tsx flatMap).
    result.set(row.id, { thumbUrl: thumbByPath.get(row.storage_path) ?? fullUrl, fullUrl });
  }
  return result;
}
