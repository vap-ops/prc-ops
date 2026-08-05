// Spec 398 D3 — the derived key for a stored thumbnail. SSOT: nothing else builds
// this string.
//
// Thumbnails live in the SAME `photos` bucket as the originals (D2): it already
// allows `image/webp`, so no bucket and no migration are needed and the existing
// Storage RLS policy covers them unchanged. The key is DERIVED, never stored —
// `photo_logs` is append-only, so a column would be a migration plus a backfill.

export const THUMB_SIZE = 320;

const THUMB_PREFIX = "thumbs/";

// Storage rejects non-ASCII object keys outright (#933). Photo paths are uuid-keyed
// and therefore ASCII by construction; this refuses anything else at the point of
// derivation rather than letting the bucket answer with a 400 at upload time.
const ASCII_ONLY = /^[\x20-\x7E]+$/;

export function isThumbKey(key: string): boolean {
  return key.startsWith(THUMB_PREFIX);
}

export function thumbKeyFor(storagePath: string): string {
  if (isThumbKey(storagePath)) {
    throw new Error(`thumbKeyFor: path is already a thumb key (${storagePath})`);
  }
  if (!ASCII_ONLY.test(storagePath)) {
    throw new Error(`thumbKeyFor: photo path is not ASCII, Storage would reject the key`);
  }
  // Suffix rather than replace the extension: the original key stays recoverable
  // from the thumb key by stripping the prefix and the suffix, and two originals
  // that differ only in extension cannot collide onto one thumb.
  return `${THUMB_PREFIX}${storagePath}.webp`;
}
