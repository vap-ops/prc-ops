// Spec 131 U2c — the documents a portal user may upload from /portal: a curated
// subset of contact_doc_purpose. Pure (client + server importable — no server-only,
// no Supabase client). The portal uploader offers exactly these; the own-doc server
// action validates against them. company_cert / vat_cert / contract are
// PM-collected (presence-only in the completeness card), so they are NOT here —
// don't over-ask the portal user, and the company papers aren't theirs to upload.

import type { Database } from "@/lib/db/database.types";

type ContactDocPurpose = Database["public"]["Enums"]["contact_doc_purpose"];

export const PORTAL_DOC_PURPOSES = [
  "id_card",
  "bank_book",
  "consent",
  "house_registration",
  "insurance",
] as const satisfies readonly ContactDocPurpose[];

export type PortalDocPurpose = (typeof PORTAL_DOC_PURPOSES)[number];

export const PORTAL_DOC_LABELS: Record<PortalDocPurpose, string> = {
  id_card: "บัตรประชาชน",
  bank_book: "สมุดบัญชีธนาคาร",
  consent: "หนังสือยินยอม",
  house_registration: "ทะเบียนบ้าน",
  insurance: "เอกสารประกัน",
};

export function isPortalDocPurpose(value: unknown): value is PortalDocPurpose {
  return typeof value === "string" && (PORTAL_DOC_PURPOSES as readonly string[]).includes(value);
}
