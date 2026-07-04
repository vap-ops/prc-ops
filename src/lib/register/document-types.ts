// Spec 263 U2 — the documents an applicant uploads from /register/technician: the
// full technician_doc_purpose enum. Pure (client + server importable — no
// server-only, no Supabase client). Mirrors src/lib/portal/document-types.ts's shape.

import type { Database } from "@/lib/db/database.types";

type TechnicianDocPurpose = Database["public"]["Enums"]["technician_doc_purpose"];

export const TECHNICIAN_DOC_PURPOSES = [
  "id_card",
  "consent",
  "profile_photo",
] as const satisfies readonly TechnicianDocPurpose[];

export type { TechnicianDocPurpose };

export const TECHNICIAN_DOC_LABELS: Record<TechnicianDocPurpose, string> = {
  id_card: "บัตรประชาชน",
  consent: "หนังสือยินยอม (PDPA)",
  profile_photo: "รูปโปรไฟล์",
};

export function isTechnicianDocPurpose(value: unknown): value is TechnicianDocPurpose {
  return (
    typeof value === "string" && (TECHNICIAN_DOC_PURPOSES as readonly string[]).includes(value)
  );
}
