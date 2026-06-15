import "server-only";

// Spec 97 — contact-document read helper. contact_attachments has ZERO
// authenticated access (PII + bank-adjacent, like contact_bank), so reads go
// through the service-role admin client, ONLY from a page already behind
// requireRole(PM_ROLES). Returns the LATEST id_card + bank_book as signed URLs
// (private bucket — never a public URL). Never expose this to a field role.

import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import type { ContactDocKind } from "@/lib/contacts/document-path";

type AdminClient = ReturnType<typeof import("@/lib/db/admin").createClient>;

const FK_COLUMN: Record<ContactDocKind, "contractor_id" | "supplier_id" | "service_provider_id"> = {
  contractor: "contractor_id",
  supplier: "supplier_id",
  service_provider: "service_provider_id",
};

export type ContactDocuments = {
  /** Signed URL of the latest ID-card image, or null. */
  idCard: string | null;
  /** Signed URL of the latest bank-book image, or null. */
  bankBook: string | null;
};

export async function getContactDocuments(
  admin: AdminClient,
  kind: ContactDocKind,
  id: string,
): Promise<ContactDocuments> {
  const { data } = await admin
    .from("contact_attachments")
    .select("id, purpose, storage_path, created_at")
    .eq(FK_COLUMN[kind], id)
    .order("created_at", { ascending: false });

  const rows = data ?? [];
  // Rows are newest-first → the first match per purpose is the current one.
  const idCardRow = rows.find((r) => r.purpose === "id_card") ?? null;
  const bankBookRow = rows.find((r) => r.purpose === "bank_book") ?? null;

  const signable = [idCardRow, bankBookRow].filter((r): r is NonNullable<typeof r> => r !== null);
  const urls = await mintSignedUrls(CONTACT_DOCS_BUCKET, signable);

  return {
    idCard: idCardRow ? (urls.get(idCardRow.id) ?? null) : null,
    bankBook: bankBookRow ? (urls.get(bankBookRow.id) ?? null) : null,
  };
}
