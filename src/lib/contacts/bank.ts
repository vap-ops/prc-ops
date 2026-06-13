import "server-only";

// Spec 88 — bank read helper. contact_bank has ZERO authenticated access
// (spec 85), so reads go through the service-role admin client, ONLY from a
// page already behind requireRole(PM_ROLES). Never expose this to a field role.

type AdminClient = ReturnType<typeof import("@/lib/db/admin").createClient>;

export type ContactKind = "contractor" | "supplier" | "service_provider";

export type ContactBank = {
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
};

const FK_COLUMN: Record<ContactKind, "contractor_id" | "supplier_id" | "service_provider_id"> = {
  contractor: "contractor_id",
  supplier: "supplier_id",
  service_provider: "service_provider_id",
};

/** The current bank row for a contact, or null. Admin client only (money). */
export async function getContactBank(
  admin: AdminClient,
  kind: ContactKind,
  id: string,
): Promise<ContactBank | null> {
  const { data } = await admin
    .from("contact_bank")
    .select("bank_name, bank_account_no, bank_account_name")
    .eq(FK_COLUMN[kind], id)
    .maybeSingle();
  if (!data) return null;
  return {
    bankName: data.bank_name ?? "",
    bankAccountNo: data.bank_account_no ?? "",
    bankAccountName: data.bank_account_name ?? "",
  };
}
