// Server-side signed-URL minting for the private `pr-attachments`
// bucket — clone of mintSignedUrlsForPhotos (spec 23 / spec 16 §4).
// Pages feed this ONLY attachment rows already selected for render
// under caller RLS (exposure radius recorded in ADR 0026/0028).

import "server-only";

import { createClient as createAdminClient } from "@/lib/db/admin";

const SIGNED_URL_TTL_SECONDS = 120;
const PR_ATTACHMENTS_BUCKET = "pr-attachments";

export interface AttachmentForSigning {
  id: string;
  storage_path: string | null;
}

export async function mintSignedUrlsForAttachments(
  attachments: ReadonlyArray<AttachmentForSigning>,
): Promise<Map<string, string>> {
  const withPath = attachments.filter(
    (a): a is AttachmentForSigning & { storage_path: string } => a.storage_path !== null,
  );
  if (withPath.length === 0) return new Map();

  const admin = createAdminClient();
  const paths = withPath.map((a) => a.storage_path);
  const { data, error } = await admin.storage
    .from(PR_ATTACHMENTS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;

  const result = new Map<string, string>();
  for (let i = 0; i < withPath.length; i++) {
    const attachment = withPath[i]!;
    const entry = data?.[i];
    if (entry && !entry.error && entry.signedUrl) {
      result.set(attachment.id, entry.signedUrl);
    }
  }
  return result;
}
