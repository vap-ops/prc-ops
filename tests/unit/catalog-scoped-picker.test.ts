// Writing failing test first.
//
// Spec 228 (ADR 0066 / S7, decisions D5 / D8) — the scoped supply-plan item
// picker. Given a WP's Relation-R material-category scope + the catalog items +
// their canonical∪secondary membership union (the S4 SSOT), the picker surfaces
// the in-scope items FIRST but NEVER hides the rest, and falls back to the full
// catalog when the scope is empty (uncategorised WP / whole-project row / empty
// Relation R). This pins the pure ordering+flagging helper that the picker
// component delegates to — the D8 "reorder/pre-filter, never hide" contract.

import { describe, expect, it } from "vitest";
import {
  scopeCatalogItems,
  scopeStockRows,
  itemInRelationScope,
} from "@/lib/catalog/scoped-picker";
import type { ScopedMaterialCategory } from "@/lib/catalog/scoped-categories";

type Item = { id: string; categoryId: string | null };

const STEEL = "cat-steel";
const ELEC = "cat-elec";
const PAINT = "cat-paint";

// Three items, one per canonical category.
const steel: Item = { id: "s1", categoryId: STEEL };
const elec: Item = { id: "e1", categoryId: ELEC };
const paint: Item = { id: "p1", categoryId: PAINT };
const items: Item[] = [steel, elec, paint];

// No secondary memberships unless a test supplies them.
const noMemberships = new Map<string, Set<string>>();

describe("scopeCatalogItems — empty/absent scope is the D8 show-all fallback", () => {
  it("returns the FULL list, original order, all unflagged when scope is undefined", () => {
    const result = scopeCatalogItems(items, noMemberships, undefined);
    expect(result.scoped).toBe(false);
    expect(result.inScopeCount).toBe(0);
    expect(result.entries.map((e) => e.item)).toEqual([steel, elec, paint]);
    expect(result.entries.every((e) => e.inScope === false)).toBe(true);
  });

  it("returns the FULL list when scope is an empty array", () => {
    const result = scopeCatalogItems(items, noMemberships, []);
    expect(result.scoped).toBe(false);
    expect(result.entries.map((e) => e.item)).toEqual([steel, elec, paint]);
  });
});

describe("scopeCatalogItems — an active scope reorders + flags, never hides", () => {
  it("puts in-scope items FIRST, flags them, keeps the rest present", () => {
    // Scope to {ELEC}: only the elec item is in scope; steel + paint stay present.
    const result = scopeCatalogItems(items, noMemberships, [ELEC]);
    expect(result.scoped).toBe(true);
    expect(result.inScopeCount).toBe(1);
    // The whole catalog is still present (never hides) — elec surfaced first.
    expect(result.entries.map((e) => e.item.id)).toEqual(["e1", "s1", "p1"]);
    expect(result.entries.find((e) => e.item.id === "e1")?.inScope).toBe(true);
    expect(result.entries.find((e) => e.item.id === "s1")?.inScope).toBe(false);
    expect(result.entries.find((e) => e.item.id === "p1")?.inScope).toBe(false);
  });

  it("surfaces every item whose category is in a multi-category scope, stable order", () => {
    const result = scopeCatalogItems(items, noMemberships, [STEEL, PAINT]);
    expect(result.inScopeCount).toBe(2);
    // In-scope (steel, paint) keep their original relative order, then the rest.
    expect(result.entries.map((e) => e.item.id)).toEqual(["s1", "p1", "e1"]);
  });

  it("counts an item via a SECONDARY membership (canonical∪secondary union, S4)", () => {
    // The steel item is ALSO (secondarily) a member of ELEC → in scope for {ELEC}.
    const memberships = new Map<string, Set<string>>([["s1", new Set([ELEC])]]);
    const result = scopeCatalogItems(items, memberships, [ELEC]);
    expect(result.inScopeCount).toBe(2); // steel (secondary) + elec (canonical)
    expect(
      result.entries
        .filter((e) => e.inScope)
        .map((e) => e.item.id)
        .sort(),
    ).toEqual(["e1", "s1"]);
  });
});

describe("scopeCatalogItems — scope present but nothing matches still shows everything", () => {
  it("keeps every item present (inScopeCount 0) so the picker is never empty", () => {
    // A work-category mapped to a material-category that has no catalog items.
    const result = scopeCatalogItems(items, noMemberships, ["cat-nonexistent"]);
    expect(result.scoped).toBe(true);
    expect(result.inScopeCount).toBe(0);
    expect(result.entries.map((e) => e.item)).toEqual([steel, elec, paint]);
    expect(result.entries.every((e) => e.inScope === false)).toBe(true);
  });
});

// Spec 229 (ADR 0066 / S8) — the เบิก on-hand scope. Unlike the PR/supply-plan
// picker (category-only, UC1), the WP เบิก honours Relation R's per-row kindFilter
// so it can SEPARATE tools (equipment family) from materials. Same D8 contract:
// in-scope rows surface first, the rest stay present, an empty relation = the full
// on-hand list. `kind` is the spec-224/S2 catalog_items.kind facet.
type StockRow = {
  catalogItemId: string;
  categoryId: string | null;
  kind: "material" | "tool" | null;
};

const wireMat: StockRow = { catalogItemId: "s-wire", categoryId: ELEC, kind: "material" };
const drillTool: StockRow = { catalogItemId: "s-drill", categoryId: ELEC, kind: "tool" };
const paintMat: StockRow = { catalogItemId: "s-paint", categoryId: PAINT, kind: "material" };
const stock: StockRow[] = [wireMat, drillTool, paintMat];

describe("scopeStockRows — empty/absent relation is the D8 show-all fallback", () => {
  it("returns every row, original order, unscoped when relation is empty or undefined", () => {
    for (const rel of [[] as ScopedMaterialCategory[], undefined]) {
      const r = scopeStockRows(stock, noMemberships, rel);
      expect(r.scoped).toBe(false);
      expect(r.inScopeCount).toBe(0);
      expect(r.entries.map((e) => e.row)).toEqual([wireMat, drillTool, paintMat]);
      expect(r.entries.every((e) => e.inScope === false)).toBe(true);
    }
  });
});

describe("scopeStockRows — an active relation surfaces in-scope rows first, never hides", () => {
  it("a category match with NO kind filter pulls every kind in that category", () => {
    const rel: ScopedMaterialCategory[] = [{ categoryId: ELEC, kindFilter: null }];
    const r = scopeStockRows(stock, noMemberships, rel);
    expect(r.scoped).toBe(true);
    expect(r.inScopeCount).toBe(2); // wire + drill (both ELEC)
    // in-scope first, the out-of-scope paint still present (never hides).
    expect(r.entries.map((e) => e.row.catalogItemId)).toEqual(["s-wire", "s-drill", "s-paint"]);
    expect(r.entries.find((e) => e.row.catalogItemId === "s-paint")?.inScope).toBe(false);
    expect(r.entries).toHaveLength(3);
  });

  it("a kind_filter separates TOOLS from MATERIALS but keeps both present", () => {
    // Relation R: within ELEC, only TOOLS are relevant for this work-category.
    const rel: ScopedMaterialCategory[] = [{ categoryId: ELEC, kindFilter: "tool" }];
    const r = scopeStockRows(stock, noMemberships, rel);
    expect(r.inScopeCount).toBe(1);
    expect(r.entries.find((e) => e.row.catalogItemId === "s-drill")?.inScope).toBe(true);
    expect(r.entries.find((e) => e.row.catalogItemId === "s-wire")?.inScope).toBe(false);
    // the drill (tool) surfaces first; the material wire is NOT hidden.
    expect(r.entries[0]?.row.catalogItemId).toBe("s-drill");
    expect(r.entries).toHaveLength(3);
  });

  it("counts a row via a SECONDARY membership (canonical∪secondary union, S4)", () => {
    // The paint stock is ALSO (secondarily) a member of ELEC → in scope for {ELEC}.
    const memberships = new Map<string, Set<string>>([["s-paint", new Set([ELEC])]]);
    const rel: ScopedMaterialCategory[] = [{ categoryId: ELEC, kindFilter: null }];
    const r = scopeStockRows(stock, memberships, rel);
    expect(r.inScopeCount).toBe(3); // wire, drill (canonical) + paint (secondary)
  });

  it("keeps every row present (inScopeCount 0) when the relation matches nothing", () => {
    const rel: ScopedMaterialCategory[] = [{ categoryId: "cat-none", kindFilter: null }];
    const r = scopeStockRows(stock, noMemberships, rel);
    expect(r.scoped).toBe(true);
    expect(r.inScopeCount).toBe(0);
    expect(r.entries.map((e) => e.row)).toEqual([wireMat, drillTool, paintMat]);
  });
});

describe("itemInRelationScope — the (category, kindFilter) predicate", () => {
  it("matches when the kindFilter is null (any kind in the category)", () => {
    expect(
      itemInRelationScope(new Set([ELEC]), "material", [{ categoryId: ELEC, kindFilter: null }]),
    ).toBe(true);
  });
  it("matches ONLY the named kind when a kindFilter is set", () => {
    const rel: ScopedMaterialCategory[] = [{ categoryId: ELEC, kindFilter: "tool" }];
    expect(itemInRelationScope(new Set([ELEC]), "tool", rel)).toBe(true);
    expect(itemInRelationScope(new Set([ELEC]), "material", rel)).toBe(false);
  });
  it("does not match a category outside the relation", () => {
    expect(
      itemInRelationScope(new Set([PAINT]), "material", [{ categoryId: ELEC, kindFilter: null }]),
    ).toBe(false);
  });
});
