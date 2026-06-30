// Bug 8e9c9fc7 — shared core for surfacing feedback attachments. The review kanban
// loaded + grouped attachment rows inline; the conversation detail page did not, so
// the operator (and the reporter) could not see attached screenshots there. This is
// the single home for both the pure grouping and the server-side loader.
//
// Feedback attachments live behind ZERO authenticated access (the table REVOKEs all
// from authenticated + has no SELECT policy — see 20260813000200). Reads happen only
// via the service-role admin, so loadFeedbackAttachmentUrls uses the admin client and
// mints short-lived signed URLs. The application-layer authorisation is the row-level
// feedback SELECT RLS the CALLER has already passed (own-or-super_admin): only pass
// feedback ids the viewer is already allowed to see.

import "server-only";

import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";

export interface AttachmentRow {
  id: string;
  feedback_id: string;
}

/** Fold attachment rows + a signed-url-by-id map into per-feedback url lists,
 * preserving row order and skipping any row whose url failed to sign. */
export function groupAttachmentUrls(
  rows: ReadonlyArray<AttachmentRow>,
  signedById: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of rows) {
    const url = signedById.get(a.id);
    if (!url) continue;
    const list = out.get(a.feedback_id) ?? [];
    list.push(url);
    out.set(a.feedback_id, list);
  }
  return out;
}

/** Load + sign the attachments for the given feedback ids. Callers MUST have already
 * authorised the viewer for these rows (passed the feedback SELECT RLS). */
export async function loadFeedbackAttachmentUrls(
  feedbackIds: ReadonlyArray<string>,
): Promise<Map<string, string[]>> {
  if (feedbackIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data: atts } = await admin
    .from("feedback_attachments")
    .select("id, feedback_id, storage_path")
    .in("feedback_id", [...feedbackIds])
    .order("created_at", { ascending: true });
  const rows = atts ?? [];
  const signed = await mintSignedUrls("feedback-attachments", rows);
  return groupAttachmentUrls(rows, signed);
}
