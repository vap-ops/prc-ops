import "server-only";
// Spec 331 — read the curated document-type registry. Both tables are
// grant-select to authenticated (firm vocabulary, not sensitive), so the
// user-context client is right; writes never come through here — they are the
// super_admin DEFINER RPCs.
import { createClient } from "@/lib/db/server";
import type { DocCategoryRow, DocTypeRow } from "./registry";

export interface DocumentRegistry {
  categories: DocCategoryRow[];
  types: DocTypeRow[];
}

export async function listDocumentRegistry(): Promise<DocumentRegistry> {
  const supabase = await createClient();
  const [{ data: categories, error: catError }, { data: types, error: typeError }] =
    await Promise.all([
      supabase
        .from("company_document_categories")
        .select("id, code, name_th, sort_order, is_active")
        .order("sort_order", { ascending: true }),
      supabase
        .from("company_document_types")
        .select(
          "id, category_id, code, name_th, hint, is_singleton, is_required, requires_expiry, sort_order, is_active",
        )
        .order("sort_order", { ascending: true }),
    ]);
  if (catError) throw new Error(`company_document_categories read failed: ${catError.message}`);
  if (typeError) throw new Error(`company_document_types read failed: ${typeError.message}`);
  return { categories: categories ?? [], types: types ?? [] };
}
