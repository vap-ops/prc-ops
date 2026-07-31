// Spec 361 U4 — pins WHICH table and WHICH filter each ข้อมูลหลัก count reads.
//
// This test exists because fresh-eyes review found two mappings wrong while
// they lived inline in the page, both invisible to every other test: the
// เทมเพลตแผนจัดหา row counted `wp_templates` (the spec-237 BOQ table) while its
// door lists `supply_plans where is_template` — 28 vs the real 2 — and the
// ผู้รับเหมาช่วง row counted every `contractors` row while its door filters
// `contractor_category = 'contractor'`. A count that disagrees with the list it
// links to is worse than no count.
//
// The fake client records (table, projection, filters) instead of talking to a
// database, so the mapping is asserted exactly.

import { describe, expect, it } from "vitest";

import { loadMasterDataCounts } from "@/lib/purchasing/master-data-counts";
import type { createClient } from "@/lib/db/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface RecordedQuery {
  table: string;
  projection: string;
  head: boolean;
  count: string | undefined;
  filters: Array<[string, unknown]>;
}

function fakeClient(rowCount: number | null, error: unknown = null) {
  const recorded: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      return {
        select(projection: string, opts?: { count?: string; head?: boolean }) {
          const entry: RecordedQuery = {
            table,
            projection,
            head: opts?.head === true,
            count: opts?.count,
            filters: [],
          };
          recorded.push(entry);
          const result = { count: rowCount, error };
          const thenable = {
            eq(column: string, value: unknown) {
              entry.filters.push([column, value]);
              return thenable;
            },
            then(resolve: (r: typeof result) => unknown) {
              return Promise.resolve(result).then(resolve);
            },
          };
          return thenable;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseServerClient, recorded };
}

describe("loadMasterDataCounts (spec 361 U4)", () => {
  it("reads each list from the table its door actually lists, with the same filter", async () => {
    const { client, recorded } = fakeClient(7);
    await loadMasterDataCounts(client);

    const byTable = Object.fromEntries(recorded.map((q) => [q.table, q]));
    expect(Object.keys(byTable).sort()).toEqual(
      [
        "catalog_categories",
        "catalog_items",
        "catalog_units",
        "contractors",
        "equipment_catalog_items",
        "equipment_categories",
        "equipment_items",
        "office_expense_categories",
        "suppliers",
        "supply_plans",
        "work_categories",
        "worker_level_rates",
      ].sort(),
    );

    // The two the review caught.
    expect(byTable.supply_plans?.filters).toEqual([["is_template", true]]);
    expect(byTable.contractors?.filters).toEqual([["contractor_category", "contractor"]]);
    // Spec 385 U3a: the ทะเบียน door counts ACTIVE SKUs — a deactivated row left
    // the picker's world, so counting it would overstate the list the door opens.
    expect(byTable.equipment_catalog_items?.filters).toEqual([["is_active", true]]);
    // `wp_templates` is a DIFFERENT list (BOQ templates) — it must not appear.
    expect(recorded.some((q) => q.table === "wp_templates")).toBe(false);

    // Active-only lists mirror what their destination renders.
    expect(byTable.catalog_items?.filters).toEqual([["is_active", true]]);
    expect(byTable.catalog_categories?.filters).toEqual([["is_active", true]]);
    expect(byTable.catalog_units?.filters).toEqual([["is_active", true]]);
    expect(byTable.work_categories?.filters).toEqual([["is_active", true]]);
    expect(byTable.office_expense_categories?.filters).toEqual([["is_active", true]]);
    expect(byTable.worker_level_rates?.filters).toEqual([["active", true]]);
    // Whole-table lists carry no filter.
    expect(byTable.equipment_items?.filters).toEqual([]);
    expect(byTable.equipment_categories?.filters).toEqual([]);
    expect(byTable.suppliers?.filters).toEqual([]);
  });

  it("projects a column each table actually has, and never a column it cannot grant", async () => {
    const { client, recorded } = fakeClient(7);
    await loadMasterDataCounts(client);
    const byTable = Object.fromEntries(recorded.map((q) => [q.table, q]));

    // catalog_units is keyed on `code`, worker_level_rates on `level`; naming a
    // missing column errors into a blank count. worker_level_rates grants
    // `authenticated` only (level, wht_basis, active, updated_at), so `*` would
    // pull the ungranted `entered_rate` and PostgREST refuses the whole read.
    expect(byTable.catalog_units?.projection).toBe("code");
    expect(byTable.worker_level_rates?.projection).toBe("level");
    expect(recorded.every((q) => q.projection !== "*")).toBe(true);
  });

  it("every query is a head count — the hub never pulls rows", async () => {
    const { client, recorded } = fakeClient(7);
    await loadMasterDataCounts(client);
    expect(recorded.every((q) => q.head && q.count === "exact")).toBe(true);
    expect(recorded).toHaveLength(12);
  });

  it("a refused read is null, never 0 — an unreadable list must not read as empty", async () => {
    const { client } = fakeClient(null, { message: "permission denied" });
    const counts = await loadMasterDataCounts(client);
    expect(Object.values(counts).every((c) => c === null)).toBe(true);
  });

  it("passes the real counts through", async () => {
    const { client } = fakeClient(42);
    const counts = await loadMasterDataCounts(client);
    expect(counts.catalogItems).toBe(42);
    expect(counts.contractors).toBe(42);
  });
});
