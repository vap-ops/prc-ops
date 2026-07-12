// Spec 301 U1 — batch project-category → global work-category code reconcile.
// The purchasing surfaces need each WP's reconciled W0x code to render the
// spec-277 letter-code (<WpCategoryCode>); this is the shared home for the
// read that four pages (projects/[projectId], /sa, /sa/crew, /sa/plan) still
// carry inline. Unreconciled categories are omitted — callers' null fallback
// renders the plain mono code (the component's graceful degrade).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export async function loadCategoryCodeById(
  supabase: SupabaseClient<Database>,
  categoryIds: Iterable<string>,
): Promise<Map<string, string>> {
  const distinct = [...new Set(categoryIds)];
  const out = new Map<string, string>();
  if (distinct.length === 0) return out;
  const { data } = await supabase
    .from("project_categories")
    .select("id, work_categories(code)")
    .in("id", distinct);
  for (const row of data ?? []) {
    // The embedded relation arrives object- or array-shaped depending on the
    // client's FK inference — accept both (same guard as loadWpCategoryScope).
    const rel = row.work_categories;
    const code = (Array.isArray(rel) ? rel[0]?.code : rel?.code) ?? null;
    if (code) out.set(row.id, code);
  }
  return out;
}
