// Spec 97 — canonical contact-document storage path:
//   {kind}/{contactId}/{attachmentId}.{ext}
// Pure module (no server-only, no Supabase) — importable from the client (upload
// target) AND the server action, which REBUILDS the path itself so a
// client-supplied path is never trusted (the pr-attachment precedent). Reuses the
// photo ext/uuid validators — same private-bucket mime set.

import { isValidPhotoExt, isValidUuid, type PhotoExt } from "@/lib/photos/path";

/** The three paid contact types that can hold documents (mirrors contact_bank). */
export const CONTACT_DOC_KINDS = ["contractor", "supplier", "service_provider"] as const;
export type ContactDocKind = (typeof CONTACT_DOC_KINDS)[number];

export const CONTACT_DOC_PURPOSES = ["id_card", "bank_book"] as const;
export type ContactDocPurpose = (typeof CONTACT_DOC_PURPOSES)[number];

export function isContactDocKind(value: unknown): value is ContactDocKind {
  return typeof value === "string" && (CONTACT_DOC_KINDS as readonly string[]).includes(value);
}

export function isContactDocPurpose(value: unknown): value is ContactDocPurpose {
  return typeof value === "string" && (CONTACT_DOC_PURPOSES as readonly string[]).includes(value);
}

export function buildContactDocPath(
  kind: ContactDocKind,
  contactId: string,
  attachmentId: string,
  ext: PhotoExt,
): string | null {
  if (!isContactDocKind(kind)) return null;
  if (!isValidUuid(contactId) || !isValidUuid(attachmentId)) return null;
  if (!isValidPhotoExt(ext)) return null;
  return `${kind}/${contactId}/${attachmentId}.${ext}`;
}
