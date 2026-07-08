import { describe, expect, it } from "vitest";

import {
  rankVendorsByCategory,
  splitSupplierOptions,
  suggestVendorsForCategories,
  type VendorCategoryEvent,
} from "@/lib/purchasing/vendor-suggestion";

const ev = (over: Partial<VendorCategoryEvent>): VendorCategoryEvent => ({
  supplierId: "s1",
  categoryId: "cat-electrical",
  purchasedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("rankVendorsByCategory", () => {
  it("groups suppliers under the category they supplied", () => {
    const out = rankVendorsByCategory([
      ev({ supplierId: "elec", categoryId: "cat-electrical" }),
      ev({ supplierId: "concrete", categoryId: "cat-concrete" }),
    ]);
    expect(out["cat-electrical"]).toEqual(["elec"]);
    expect(out["cat-concrete"]).toEqual(["concrete"]);
  });

  it("ranks by committed-PR count in the category (desc)", () => {
    const out = rankVendorsByCategory([
      ev({ supplierId: "often", categoryId: "c" }),
      ev({ supplierId: "often", categoryId: "c" }),
      ev({ supplierId: "often", categoryId: "c" }),
      ev({ supplierId: "rare", categoryId: "c" }),
    ]);
    expect(out["c"]).toEqual(["often", "rare"]);
  });

  it("breaks count ties by most-recent purchase (desc)", () => {
    const out = rankVendorsByCategory([
      ev({ supplierId: "old", categoryId: "c", purchasedAt: "2025-01-01T00:00:00Z" }),
      ev({ supplierId: "new", categoryId: "c", purchasedAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(out["c"]).toEqual(["new", "old"]);
  });

  it("dedupes a supplier that appears many times into one ranked id", () => {
    const out = rankVendorsByCategory([
      ev({ supplierId: "dup", categoryId: "c" }),
      ev({ supplierId: "dup", categoryId: "c" }),
    ]);
    expect(out["c"]).toEqual(["dup"]);
  });

  it("skips events with no category (uncatalogued PRs contribute nothing)", () => {
    const out = rankVendorsByCategory([ev({ supplierId: "x", categoryId: null })]);
    expect(out).toEqual({});
  });

  it("returns an empty map for no events", () => {
    expect(rankVendorsByCategory([])).toEqual({});
  });
});

describe("splitSupplierOptions", () => {
  const all = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Bravo" },
    { id: "c", name: "Charlie" },
  ];

  it("splits into suggested (ranked order) + rest (the remainder)", () => {
    const { suggested, rest } = splitSupplierOptions(all, ["c", "a"]);
    expect(suggested.map((s) => s.id)).toEqual(["c", "a"]);
    expect(rest.map((s) => s.id)).toEqual(["b"]);
  });

  it("ignores suggested ids not present in the full list", () => {
    const { suggested, rest } = splitSupplierOptions(all, ["ghost", "b"]);
    expect(suggested.map((s) => s.id)).toEqual(["b"]);
    expect(rest.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("puts everything in rest when there are no suggestions (show-all fallback)", () => {
    const { suggested, rest } = splitSupplierOptions(all, []);
    expect(suggested).toEqual([]);
    expect(rest.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("preserves the original order within rest", () => {
    const { rest } = splitSupplierOptions(all, ["b"]);
    expect(rest.map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("suggestVendorsForCategories (multi-line PO union)", () => {
  const catVendors = {
    electrical: ["elecA", "elecB"],
    concrete: ["concX", "elecA"],
  };

  it("returns a single category's ranking when the PO is one category", () => {
    expect(suggestVendorsForCategories(catVendors, ["electrical"])).toEqual(["elecA", "elecB"]);
  });

  it("ranks a vendor covering MORE of the PO's categories first", () => {
    // elecA supplied both electrical + concrete → ahead of single-category vendors.
    // Among the single-coverage rest, concX (rank-0 in concrete) beats elecB
    // (rank-1 in electrical) on the best-position tiebreak.
    const out = suggestVendorsForCategories(catVendors, ["electrical", "concrete"]);
    expect(out[0]).toBe("elecA");
    expect(out).toEqual(["elecA", "concX", "elecB"]);
  });

  it("breaks coverage ties by best rank position across the categories", () => {
    const cv = { c1: ["p", "q"], c2: ["q", "p"] };
    // p best pos 0 (in c1), q best pos 0 (in c2) → tie on coverage(2) & bestPos(0);
    // stable by first-seen (c1 processed first → p before q)
    expect(suggestVendorsForCategories(cv, ["c1", "c2"])).toEqual(["p", "q"]);
  });

  it("ignores null / unknown categories", () => {
    expect(suggestVendorsForCategories(catVendors, [null, "ghost", undefined])).toEqual([]);
  });

  it("dedupes categories and returns [] for no known categories", () => {
    expect(suggestVendorsForCategories({}, ["x", "x"])).toEqual([]);
  });
});
