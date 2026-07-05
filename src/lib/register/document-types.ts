// Spec 263 U2 / spec 264 G1 — the documents an applicant uploads from
// /register/technician: the staff_doc_purpose enum (renamed from
// technician_doc_purpose; `consent` retired — PDPA consent is now an in-app
// record, not a file upload). Pure (client + server importable — no server-only,
// no Supabase client). Mirrors src/lib/portal/document-types.ts's shape.

import type { Database } from "@/lib/db/database.types";

type TechnicianDocPurpose = Database["public"]["Enums"]["staff_doc_purpose"];

export const TECHNICIAN_DOC_PURPOSES = [
  "id_card",
  "profile_photo",
] as const satisfies readonly TechnicianDocPurpose[];

export type { TechnicianDocPurpose };

export const TECHNICIAN_DOC_LABELS: Record<TechnicianDocPurpose, string> = {
  id_card: "บัตรประชาชน",
  profile_photo: "รูปโปรไฟล์",
};

export function isTechnicianDocPurpose(value: unknown): value is TechnicianDocPurpose {
  return (
    typeof value === "string" && (TECHNICIAN_DOC_PURPOSES as readonly string[]).includes(value)
  );
}
