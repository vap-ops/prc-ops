// Server-side signed-URL minting for the private `pr-attachments`
// bucket (spec 23 / spec 16 §4). Since spec 65 the implementation is the
// generic core in src/lib/storage/signed-urls.ts (shared with the photos
// wrapper). Pages feed this ONLY attachment rows already selected for
// render under caller RLS (exposure radius recorded in ADR 0026/0028).

import "server-only";

import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PR_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";

export interface AttachmentForSigning {
  id: string;
  storage_path: string | null;
}

export async function mintSignedUrlsForAttachments(
  attachments: ReadonlyArray<AttachmentForSigning>,
): Promise<Map<string, string>> {
  return mintSignedUrls(PR_ATTACHMENTS_BUCKET, attachments);
}
