// Spec 230 (ADR 0066 / S9) — the procurement-grid material-category facet. A pure
// helper pair: build the facet chips (counts from the FULL dataset, so they never
// shift as a filter is applied) and decide whether a record matches the selected
// chip. The facet is opt-in and show-all-safe — the component owns the always-present
// "ทั้งหมด" chip; this helper only enumerates the present categories + an unset bucket.

import { describe, expect, it } from "vitest";
import {
  CATEGORY_ALL,
  CATEGORY_NONE,
  buildCategoryFacets,
  recordMatchesCategory,
} from "@/lib/purchasing/category-facet";

const UNSET = "ไม่ระบุหมวดหมู่";

const records = [
  { categoryId: "steel", categoryName: "เหล็ก" },
  { categoryId: "steel", categoryName: "เหล็ก" },
  { categoryId: "steel", categoryName: "เหล็ก" },
  { categoryId: "paint", categoryName: "สี" },
  { categoryId: null, categoryName: null },
  { categoryId: null, categoryName: null },
];

describe("buildCategoryFacets", () => {
  it("counts each present category over the full dataset, sorted by count desc", () => {
    expect(buildCategoryFacets(records, UNSET)).toEqual([
      { id: "steel", name: "เหล็ก", count: 3 },
      { id: "paint", name: "สี", count: 1 },
      // The unset bucket is appended LAST, regardless of its count.
      { id: CATEGORY_NONE, name: UNSET, count: 2 },
    ]);
  });

  it("omits the unset chip when every record has a category", () => {
    const facets = buildCategoryFacets(
      [
        { categoryId: "steel", categoryName: "เหล็ก" },
        { categoryId: "paint", categoryName: "สี" },
      ],
      UNSET,
    );
    expect(facets.some((f) => f.id === CATEGORY_NONE)).toBe(false);
  });

  it("tie-breaks equal counts by name", () => {
    // Equal counts (1 each) → ordered by name asc ("Aaa" before "Bbb").
    const facets = buildCategoryFacets(
      [
        { categoryId: "id-b", categoryName: "Bbb" },
        { categoryId: "id-a", categoryName: "Aaa" },
      ],
      UNSET,
    );
    expect(facets.map((f) => f.id)).toEqual(["id-a", "id-b"]);
  });

  it("empty dataset → no facets", () => {
    expect(buildCategoryFacets([], UNSET)).toEqual([]);
  });

  // A category id with no resolvable name (e.g. the category was deactivated, so the
  // active-only loadCatalogCategories doesn't carry its name) must NEVER surface as a
  // raw-uuid chip — it folds into the unset bucket instead (spec 230: "never a raw uuid").
  it("folds an id-without-name record into the unset bucket, never a raw-id chip", () => {
    const facets = buildCategoryFacets(
      [
        { categoryId: "deactivated-uuid", categoryName: null },
        { categoryId: "steel", categoryName: "เหล็ก" },
      ],
      UNSET,
    );
    expect(facets.some((f) => f.id === "deactivated-uuid" || f.name === "deactivated-uuid")).toBe(
      false,
    );
    expect(facets).toEqual([
      { id: "steel", name: "เหล็ก", count: 1 },
      { id: CATEGORY_NONE, name: UNSET, count: 1 },
    ]);
  });
});

describe("recordMatchesCategory", () => {
  it("ALL matches everything (show-all default)", () => {
    expect(recordMatchesCategory({ categoryId: "steel" }, CATEGORY_ALL)).toBe(true);
    expect(recordMatchesCategory({ categoryId: null }, CATEGORY_ALL)).toBe(true);
  });

  it("a category id matches only that category", () => {
    expect(recordMatchesCategory({ categoryId: "steel" }, "steel")).toBe(true);
    expect(recordMatchesCategory({ categoryId: "paint" }, "steel")).toBe(false);
    expect(recordMatchesCategory({ categoryId: null }, "steel")).toBe(false);
  });

  it("NONE matches only uncategorised records", () => {
    expect(recordMatchesCategory({ categoryId: null }, CATEGORY_NONE)).toBe(true);
    expect(recordMatchesCategory({ categoryId: "steel" }, CATEGORY_NONE)).toBe(false);
  });
});
