// Writing failing test first.
//
// Spec 227 (ADR 0066 D5) — Relation R resolver. For a given WP's reconciled
// work-category, resolve the set of (categoryId, kindFilter) material-category rows
// the scoped pickers (specs 228/229) pre-filter to. A seeded work-category returns
// its mapped rows; an UNMAPPED work-category returns an empty array — the pickers'
// show-all fallback (ADR 0066 D8) depends on this empty case.

import { describe, expect, it, vi } from "vitest";
import {
  resolveScopedCategories,
  type ScopedMaterialCategory,
} from "@/lib/catalog/scoped-categories";

type Row = { category_id: string; kind_filter: ScopedMaterialCategory["kindFilter"] };

// Minimal stub of the supabase query builder for the one query the resolver runs:
// .from(table).select(cols).eq(col, value) -> { data, error }.
function stubSupabase(rows: Row[] | null) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as unknown as Parameters<typeof resolveScopedCategories>[0],
    spies: { from, select, eq },
  };
}

describe("resolveScopedCategories (spec 227)", () => {
  it("returns the mapped (categoryId, kindFilter) rows for a seeded work-category", async () => {
    const rows: Row[] = [
      { category_id: "cat-01", kind_filter: null },
      { category_id: "cat-08", kind_filter: null },
    ];
    const { client, spies } = stubSupabase(rows);
    const result = await resolveScopedCategories(client, "wc-w02");

    expect(spies.from).toHaveBeenCalledWith("work_category_material_categories");
    expect(spies.select).toHaveBeenCalledWith("category_id, kind_filter");
    expect(spies.eq).toHaveBeenCalledWith("work_category_id", "wc-w02");
    expect(result).toEqual<ScopedMaterialCategory[]>([
      { categoryId: "cat-01", kindFilter: null },
      { categoryId: "cat-08", kindFilter: null },
    ]);
  });

  it("preserves a non-null kind_filter on a relation row", async () => {
    const { client } = stubSupabase([{ category_id: "cat-10", kind_filter: "tool" }]);
    const result = await resolveScopedCategories(client, "wc-w05");
    expect(result).toEqual<ScopedMaterialCategory[]>([
      { categoryId: "cat-10", kindFilter: "tool" },
    ]);
  });

  it("returns an empty array for an unmapped work-category (show-all fallback)", async () => {
    const { client } = stubSupabase([]);
    expect(await resolveScopedCategories(client, "wc-w07")).toEqual([]);
  });

  it("returns an empty array when the query yields no data (null)", async () => {
    const { client } = stubSupabase(null);
    expect(await resolveScopedCategories(client, "wc-missing")).toEqual([]);
  });
});
