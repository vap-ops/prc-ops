// Spec 263 U2 — canonical technician registration document storage path:
//   technician/{uid}/{purpose}/{attachmentId}.{ext}
// Pure module (no server-only, no Supabase) — importable from the client (upload
// target) AND the server action, which REBUILDS the path itself so a
// client-supplied path is never trusted (mirrors buildContactDocPath's
// discipline, spec 97). Distinct 3-segment shape from buildContactDocPath's
// 2-segment kind/contactId — matches the U1b storage policies' foldername
// indexing (technician/<auth.uid()>/<purpose>/…).

import { isValidPhotoExt, isValidUuid, type PhotoExt } from "@/lib/photos/path";
import { isTechnicianDocPurpose, type TechnicianDocPurpose } from "./document-types";

export function buildTechnicianDocPath(
  uid: string,
  purpose: TechnicianDocPurpose,
  attachmentId: string,
  ext: PhotoExt,
): string | null {
  if (!isValidUuid(uid) || !isValidUuid(attachmentId)) return null;
  if (!isTechnicianDocPurpose(purpose)) return null;
  if (!isValidPhotoExt(ext)) return null;
  return `technician/${uid}/${purpose}/${attachmentId}.${ext}`;
}
