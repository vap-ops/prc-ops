// Spec 263 U2 / spec 264 G1+G2 — canonical staff registration document storage
// path:
//   technician/{uid}/{purpose}/{attachmentId}.{ext}
// The `technician/` prefix + this file's name are KEPT (spec 264 G1 decision):
// the storage path is an internal path, not a role assertion, and renaming it
// would orphan in-flight uploads — not worth the churn for v1. Pure module (no
// server-only, no Supabase) — importable from the client (upload target) AND
// the server action, which REBUILDS the path itself so a client-supplied path
// is never trusted (mirrors buildContactDocPath's discipline, spec 97).
// Distinct 3-segment shape from buildContactDocPath's 2-segment kind/contactId
// — matches the storage policies' foldername indexing (technician/<auth.uid()>/<purpose>/…).

import { isValidPhotoExt, isValidUuid, type PhotoExt } from "@/lib/photos/path";
import { isStaffDocPurpose, type StaffDocPurpose } from "./document-types";

export function buildTechnicianDocPath(
  uid: string,
  purpose: StaffDocPurpose,
  attachmentId: string,
  ext: PhotoExt,
): string | null {
  if (!isValidUuid(uid) || !isValidUuid(attachmentId)) return null;
  if (!isStaffDocPurpose(purpose)) return null;
  if (!isValidPhotoExt(ext)) return null;
  return `technician/${uid}/${purpose}/${attachmentId}.${ext}`;
}
