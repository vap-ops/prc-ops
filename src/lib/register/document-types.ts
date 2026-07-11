// Spec 263 U2 / spec 264 G1+G2 — the documents an applicant uploads from
// /register/technician: the staff_doc_purpose enum (renamed from
// technician_doc_purpose; `consent` retired — PDPA consent is now an in-app
// record, not a file upload). Pure (client + server importable — no server-only,
// no Supabase client). Mirrors src/lib/portal/document-types.ts's shape.

import type { Database } from "@/lib/db/database.types";

export type StaffDocPurpose = Database["public"]["Enums"]["staff_doc_purpose"];

export const STAFF_DOC_PURPOSES = [
  "id_card",
  "book_bank",
  "profile_photo",
] as const satisfies readonly StaffDocPurpose[];

export const STAFF_DOC_LABELS: Record<StaffDocPurpose, string> = {
  id_card: "บัตรประชาชน",
  book_bank: "สมุดบัญชีธนาคาร",
  profile_photo: "รูปโปรไฟล์",
};

export function isStaffDocPurpose(value: unknown): value is StaffDocPurpose {
  return typeof value === "string" && (STAFF_DOC_PURPOSES as readonly string[]).includes(value);
}
