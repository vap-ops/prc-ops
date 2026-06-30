// Writing failing test first.
//
// Spec 221 cleanup — the shared catalog-categories loader. The store readers (and
// /catalog) load the managed catalog_categories the same way: id/code/name,
// is_active, ordered by sort_order then code. Single-sourced here so a reader
// reads category_id + the category NAME, not the vestigial item_category enum.

import { describe, expect, it, vi } from "vitest";
import {
  loadCatalogCategories,
  categoryNameById,
  type CatalogCategoryOption,
} from "@/lib/catalog/categories";

type Row = { id: string; code: string; name: string };

// A minimal stub of the supabase query builder for the one query the loader runs.
function stubSupabase(rows: Row[] | null) {
  const order2 = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order1 = vi.fn(() => ({ order: order2 }));
  const eq = vi.fn(() => ({ order: order1 }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as unknown as Parameters<typeof loadCatalogCategories>[0],
    spies: { from, select, eq, order1, order2 },
  };
}

describe("loadCatalogCategories (spec 221)", () => {
  it("reads active categories ordered by sort_order then code", async () => {
    const rows: Row[] = [
      { id: "c1", code: "01", name: "ไฟฟ้า" },
      { id: "c2", code: "02", name: "ประปา" },
    ];
    const { client, spies } = stubSupabase(rows);
    const result = await loadCatalogCategories(client);

    expect(spies.from).toHaveBeenCalledWith("catalog_categories");
    expect(spies.select).toHaveBeenCalledWith("id, code, name");
    expect(spies.eq).toHaveBeenCalledWith("is_active", true);
    expect(spies.order1).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(spies.order2).toHaveBeenCalledWith("code", { ascending: true });
    expect(result).toEqual<CatalogCategoryOption[]>([
      { id: "c1", code: "01", name: "ไฟฟ้า" },
      { id: "c2", code: "02", name: "ประปา" },
    ]);
  });

  it("returns an empty list when the query yields no rows", async () => {
    const { client } = stubSupabase(null);
    expect(await loadCatalogCategories(client)).toEqual([]);
  });
});

describe("categoryNameById (spec 221)", () => {
  it("maps each category id to its name", () => {
    const cats: CatalogCategoryOption[] = [
      { id: "c1", code: "01", name: "ไฟฟ้า" },
      { id: "c2", code: "02", name: "ประปา" },
    ];
    const map = categoryNameById(cats);
    expect(map.get("c1")).toBe("ไฟฟ้า");
    expect(map.get("c2")).toBe("ประปา");
    expect(map.get("missing")).toBeUndefined();
  });

  it("is empty for an empty category list", () => {
    expect(categoryNameById([]).size).toBe(0);
  });
});
