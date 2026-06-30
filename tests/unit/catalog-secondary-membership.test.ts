// Writing failing test first.
//
// Spec 225 (ADR 0066 / S4, decision D2) — secondary material membership. A
// catalog item keeps ONE canonical home (category_id) but can also appear under
// other groupings via the additive catalog_item_categories junction. The pickers
// read the UNION of the canonical home and the secondary memberships
// (de-duplicated). This pins the reader + the pure union helpers in
// src/lib/catalog/categories.ts — the SSOT the scoped pickers consume.

import { describe, expect, it, vi } from "vitest";
import {
  loadCatalogItemMemberships,
  membershipsByItem,
  itemCategoryIds,
  itemInCategoryScope,
  type CatalogItemMembership,
} from "@/lib/catalog/categories";

type Row = { catalog_item_id: string; category_id: string };

// Minimal stub of the supabase query builder for the one query the loader runs.
function stubSupabase(rows: Row[] | null) {
  const select = vi.fn().mockResolvedValue({ data: rows, error: null });
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as unknown as Parameters<typeof loadCatalogItemMemberships>[0],
    spies: { from, select },
  };
}

describe("loadCatalogItemMemberships (spec 225)", () => {
  it("reads catalog_item_categories as { catalogItemId, categoryId }", async () => {
    const rows: Row[] = [
      { catalog_item_id: "i1", category_id: "cA" },
      { catalog_item_id: "i1", category_id: "cB" },
    ];
    const { client, spies } = stubSupabase(rows);
    const result = await loadCatalogItemMemberships(client);

    expect(spies.from).toHaveBeenCalledWith("catalog_item_categories");
    expect(spies.select).toHaveBeenCalledWith("catalog_item_id, category_id");
    expect(result).toEqual<CatalogItemMembership[]>([
      { catalogItemId: "i1", categoryId: "cA" },
      { catalogItemId: "i1", categoryId: "cB" },
    ]);
  });

  it("returns an empty list when the query yields no rows", async () => {
    const { client } = stubSupabase(null);
    expect(await loadCatalogItemMemberships(client)).toEqual([]);
  });
});

describe("membershipsByItem (spec 225)", () => {
  it("groups membership category ids per item", () => {
    const map = membershipsByItem([
      { catalogItemId: "i1", categoryId: "cA" },
      { catalogItemId: "i1", categoryId: "cB" },
      { catalogItemId: "i2", categoryId: "cA" },
    ]);
    expect([...(map.get("i1") ?? [])].sort()).toEqual(["cA", "cB"]);
    expect([...(map.get("i2") ?? [])]).toEqual(["cA"]);
    expect(map.get("missing")).toBeUndefined();
  });
});

describe("itemCategoryIds — canonical ∪ secondary, de-duplicated (spec 225)", () => {
  it("unions the canonical home with the secondary memberships", () => {
    const ids = itemCategoryIds("cA", new Set(["cB", "cC"]));
    expect([...ids].sort()).toEqual(["cA", "cB", "cC"]);
  });

  it("de-duplicates when the canonical home is also a secondary membership", () => {
    const ids = itemCategoryIds("cA", new Set(["cA", "cB"]));
    expect([...ids].sort()).toEqual(["cA", "cB"]);
  });

  it("falls back to just the canonical home when there are no secondaries", () => {
    expect([...itemCategoryIds("cA", undefined)]).toEqual(["cA"]);
  });

  it("yields just the secondaries when the canonical home is null", () => {
    expect([...itemCategoryIds(null, new Set(["cB"]))]).toEqual(["cB"]);
  });
});

describe("itemInCategoryScope — the picker union (spec 225)", () => {
  // The headline criterion: an item secondarily linked to category X appears
  // under X's picker scope AS WELL AS under its canonical home.
  it("shows an item under both its canonical home and a secondary category", () => {
    const canonical = "cA";
    const secondary = new Set(["cX"]);
    expect(itemInCategoryScope(canonical, secondary, "cA")).toBe(true); // canonical home
    expect(itemInCategoryScope(canonical, secondary, "cX")).toBe(true); // secondary membership
  });

  it("does not show the item under an unrelated category", () => {
    expect(itemInCategoryScope("cA", new Set(["cX"]), "cZ")).toBe(false);
  });

  it("still scopes by the canonical home with no secondaries", () => {
    expect(itemInCategoryScope("cA", undefined, "cA")).toBe(true);
    expect(itemInCategoryScope("cA", undefined, "cB")).toBe(false);
  });
});
