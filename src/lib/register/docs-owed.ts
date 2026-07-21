// Spec 333 U2 — pure derive for the post-approval docs-owed view (same
// discipline as registration-floor.ts: no Supabase, no server-only). Only an
// APPROVED registration whose approval deferred the document floors
// (documents_deferred_at, mig 075822) owes anything, and the owed set is
// exactly the missing document floors — full_name + PDPA consent were enforced
// BEFORE the deferred approval, so they can never be owed here. UI derive
// only; the RPC carves (add_staff_registration_doc / record_own_staff_bank)
// stay authoritative.

import type { Database } from "@/lib/db/database.types";

type RegistrationStatus = Database["public"]["Enums"]["registration_status"];

export type OwedDoc = "id_card" | "book_bank" | "bank_fields";

export interface DeferredDocsInput {
  status: RegistrationStatus;
  documentsDeferredAt: string | null;
  hasIdCard: boolean;
  hasBookBank: boolean;
  hasBankFields: boolean;
}

export function deferredDocsOwed(input: DeferredDocsInput): OwedDoc[] {
  if (input.status !== "approved" || input.documentsDeferredAt === null) return [];
  const owed: OwedDoc[] = [];
  if (!input.hasIdCard) owed.push("id_card");
  if (!input.hasBookBank) owed.push("book_bank");
  if (!input.hasBankFields) owed.push("bank_fields");
  return owed;
}
