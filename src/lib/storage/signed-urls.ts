// Generic signed-URL minting core (spec 65) — the shared implementation
// behind mintSignedUrlsForPhotos and mintSignedUrlsForAttachments, which
// were byte-identical clones (the attachments module said so itself).
//
// Reads on the private buckets are NOT covered by storage.objects SELECT
// RLS — reads only happen via service-role-minted signed URLs. The
// application-layer authorisation is the row-level SELECT RLS the caller
// has already passed: inputs are rows the caller already read under the
// user's session (exposure radius recorded in ADR 0015 / 0026 / 0028).
// Tombstones (storage_path NULL) are skipped — nothing to sign.

import "server-only";

import { createClient as createAdminClient } from "@/lib/db/admin";

// 120 seconds: middle of the 60–300s window spec 03 specifies. Long
// enough for the page to load and the browser to fetch every thumbnail;
// short enough that a leaked URL has very little value.
const SIGNED_URL_TTL_SECONDS = 120;

export interface SignableRow {
  id: string;
  storage_path: string | null;
}

export async function mintSignedUrls(
  bucket: string,
  rows: ReadonlyArray<SignableRow>,
): Promise<Map<string, string>> {
  const withPath = rows.filter(
    (r): r is SignableRow & { storage_path: string } => r.storage_path !== null,
  );
  if (withPath.length === 0) return new Map();

  const admin = createAdminClient();
  const paths = withPath.map((r) => r.storage_path);
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;

  const result = new Map<string, string>();
  for (let i = 0; i < withPath.length; i++) {
    const row = withPath[i]!;
    const entry = data?.[i];
    if (entry && !entry.error && entry.signedUrl) {
      result.set(row.id, entry.signedUrl);
    }
  }
  return result;
}
