// Spec 320 U2 — canonical consent-photo storage path for a temporary payout
// nominee:
//   nominee-consent/{workerId}/{attachmentId}.{ext}
// Pure module (no server-only, no Supabase) — importable from the client (upload
// target) AND the server action, which REBUILDS the path so a client-supplied
// path is never trusted (mirrors buildTechnicianDocPath, spec 263/264). The
// 2-segment folder shape matches the PM-scoped storage INSERT policy + the
// set_worker_payout_nominee folder-pin (foldername = ['nominee-consent', workerId]).

import { isValidPhotoExt, isValidUuid, type PhotoExt } from "@/lib/photos/path";

export function buildNomineeConsentPath(
  workerId: string,
  attachmentId: string,
  ext: PhotoExt,
): string | null {
  if (!isValidUuid(workerId) || !isValidUuid(attachmentId)) return null;
  if (!isValidPhotoExt(ext)) return null;
  return `nominee-consent/${workerId}/${attachmentId}.${ext}`;
}
