import "server-only";
// Spec 329 — user-context read; the table SELECT policy is the gate. Grouping
// in memory (group-documents.ts) per the current-photos anti-join precedent.
import { createClient } from "@/lib/db/server";
import { groupDocuments, type CompanyDocument } from "./group-documents";

export async function listCompanyDocuments(): Promise<CompanyDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`company_documents read failed: ${error.message}`);
  return groupDocuments(data ?? []);
}
