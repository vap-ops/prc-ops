// Spec 361 U4 — the count loader for the ข้อมูลหลัก hub, extracted from the page
// so the table/filter mapping is testable without a database. Fresh-eyes review
// found two mappings wrong while they lived inline in the page (เทมเพลตแผนจัดหา
// counted `wp_templates` — the dormant spec-142 U5 WP-template table, since
// RETIRED unused (2026-07-27, mig `075857`) — while its door lists
// `supply_plans where is_template`; ผู้รับเหมาช่วง counted every `contractors`
// row while its door lists `contractor_category = 'contractor'` only). A count
// that disagrees with the list it links to is worse than no count, so each query
// below mirrors its destination's own filter — the pairs are pinned in
// master-data-counts.test.ts.
//
// Two projection rules learned the hard way:
// - never `select("id")`: `catalog_units` is keyed on `code`, `worker_level_rates`
//   on `level`, and naming an absent column errors into a silently blank count.
// - never `select("*")` on a column-GRANTED table: `worker_level_rates` grants
//   `authenticated` only (level, wht_basis, active, updated_at), so `*` pulls the
//   ungranted `entered_rate` and PostgREST refuses the whole read.
//
// A failed count stays null — the board renders no number rather than telling
// her a populated list is empty.

import type { MasterDataCounts } from "@/lib/purchasing/master-data";
import type { createClient } from "@/lib/db/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const HEAD_COUNT = { count: "exact", head: true } as const;

async function readCount(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  const { count, error } = await query;
  return error ? null : (count ?? null);
}

export async function loadMasterDataCounts(
  supabase: SupabaseServerClient,
): Promise<MasterDataCounts> {
  const [
    catalogItems,
    catalogCategories,
    catalogUnits,
    orderingTemplates,
    equipmentItems,
    equipmentCategories,
    workCategories,
    workerLevelRates,
    expenseCategories,
    suppliers,
    contractors,
  ] = await Promise.all([
    readCount(supabase.from("catalog_items").select("id", HEAD_COUNT).eq("is_active", true)),
    readCount(supabase.from("catalog_categories").select("id", HEAD_COUNT).eq("is_active", true)),
    readCount(supabase.from("catalog_units").select("code", HEAD_COUNT).eq("is_active", true)),
    // The door (/settings/ordering-templates) lists supply_plans. (It never listed
    // the retired `wp_templates`; that mis-mapping is the one described up top.)
    readCount(supabase.from("supply_plans").select("id", HEAD_COUNT).eq("is_template", true)),
    readCount(supabase.from("equipment_items").select("id", HEAD_COUNT)),
    readCount(supabase.from("equipment_categories").select("id", HEAD_COUNT)),
    readCount(supabase.from("work_categories").select("id", HEAD_COUNT).eq("is_active", true)),
    // Column-granted table: project `level`, and mirror the door's active filter.
    readCount(supabase.from("worker_level_rates").select("level", HEAD_COUNT).eq("active", true)),
    readCount(
      supabase.from("office_expense_categories").select("id", HEAD_COUNT).eq("is_active", true),
    ),
    readCount(supabase.from("suppliers").select("id", HEAD_COUNT)),
    // The door (/contacts/subcontractors) shows contractor-category rows only —
    // the same table also holds the DC crews.
    readCount(
      supabase.from("contractors").select("id", HEAD_COUNT).eq("contractor_category", "contractor"),
    ),
  ]);

  return {
    catalogItems,
    catalogCategories,
    catalogUnits,
    orderingTemplates,
    equipmentItems,
    equipmentCategories,
    workCategories,
    workerLevelRates,
    expenseCategories,
    suppliers,
    contractors,
  };
}
