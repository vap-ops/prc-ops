// Spec 289 U1 — the WP-detail category chain (this WP's project-category name,
// its reconciled global work-category code, and the Relation-R scoped
// material-categories), extracted from the page so the whole 2-deep chain can
// ride the page's big Promise.all instead of running as a post-batch serial
// tail. Same reads, same columns, same fallbacks as the inline version it
// replaces (specs 226/229/277).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { resolveScopedCategories, type ScopedMaterialCategory } from "./scoped-categories";

export interface WpCategoryScope {
  /** The project-category's name — the header badge. Null when unbound/missing. */
  workCategoryName: string | null;
  /** The reconciled GLOBAL work-category code (W01–W09 letter chip); null when
   *  the project-category isn't reconciled. */
  workCategoryCode: string | null;
  /** Relation R rows for the scoped pickers; empty → show-all fallback (D8). */
  scopedRelation: ScopedMaterialCategory[];
}

const EMPTY: WpCategoryScope = {
  workCategoryName: null,
  workCategoryCode: null,
  scopedRelation: [],
};

export async function loadWpCategoryScope(
  supabase: SupabaseClient<Database>,
  categoryId: string | null,
): Promise<WpCategoryScope> {
  if (!categoryId) return EMPTY;
  const { data: wpCategory } = await supabase
    .from("project_categories")
    .select("name, work_category_id, work_categories(code)")
    .eq("id", categoryId)
    .maybeSingle();
  if (!wpCategory) return EMPTY;
  if (!wpCategory.work_category_id) {
    return { workCategoryName: wpCategory.name, workCategoryCode: null, scopedRelation: [] };
  }
  // The embedded relation arrives object- or array-shaped depending on the
  // client's FK inference — accept both (same guard the page carried).
  const wcRel = wpCategory.work_categories;
  const workCategoryCode = (Array.isArray(wcRel) ? wcRel[0]?.code : wcRel?.code) ?? null;
  const scopedRelation = await resolveScopedCategories(supabase, wpCategory.work_category_id);
  return { workCategoryName: wpCategory.name, workCategoryCode, scopedRelation };
}
