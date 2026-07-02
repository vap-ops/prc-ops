// Spec 245 U3 — pure grouping helper for the supply-plan saved-lines list.
// Groups lines by the item's managed category, in the managed category order;
// omits empty categories; uncategorized (null or unknown category) fall into a
// single trailing "อื่นๆ" group; within a group, input order is preserved.

import { describe, expect, it } from "vitest";
import { groupLinesByCategory, UNCATEGORIZED_LABEL } from "@/lib/supply-plan/group-lines";

type L = { id: string; categoryId: string | null };

const categories = [
  { id: "cat-a", name: "หมวด A" },
  { id: "cat-b", name: "หมวด B" },
  { id: "cat-c", name: "หมวด C" },
];

describe("groupLinesByCategory (spec 245 U3)", () => {
  it("returns no groups for an empty line list", () => {
    expect(groupLinesByCategory<L>([], categories)).toEqual([]);
  });

  it("groups lines by category in the managed category order (not line order)", () => {
    const lines: L[] = [
      { id: "1", categoryId: "cat-b" },
      { id: "2", categoryId: "cat-a" },
      { id: "3", categoryId: "cat-b" },
    ];
    const groups = groupLinesByCategory(lines, categories);
    expect(groups.map((g) => g.categoryId)).toEqual(["cat-a", "cat-b"]);
    expect(groups.map((g) => g.categoryName)).toEqual(["หมวด A", "หมวด B"]);
    expect(groups[0]!.lines.map((l) => l.id)).toEqual(["2"]);
    // Within a group, original input order is preserved.
    expect(groups[1]!.lines.map((l) => l.id)).toEqual(["1", "3"]);
  });

  it("omits categories that have no lines", () => {
    const lines: L[] = [{ id: "1", categoryId: "cat-c" }];
    const groups = groupLinesByCategory(lines, categories);
    expect(groups.map((g) => g.categoryId)).toEqual(["cat-c"]);
  });

  it("puts null-category lines into a single trailing อื่นๆ group", () => {
    const lines: L[] = [
      { id: "1", categoryId: null },
      { id: "2", categoryId: "cat-a" },
      { id: "3", categoryId: null },
    ];
    const groups = groupLinesByCategory(lines, categories);
    expect(groups.map((g) => g.categoryId)).toEqual(["cat-a", null]);
    const other = groups.at(-1)!;
    expect(other.categoryName).toBe(UNCATEGORIZED_LABEL);
    expect(other.lines.map((l) => l.id)).toEqual(["1", "3"]);
  });

  it("treats an unknown category id as uncategorized (folds into อื่นๆ)", () => {
    const lines: L[] = [
      { id: "1", categoryId: "cat-gone" },
      { id: "2", categoryId: "cat-a" },
    ];
    const groups = groupLinesByCategory(lines, categories);
    expect(groups.map((g) => g.categoryId)).toEqual(["cat-a", null]);
    expect(groups.at(-1)!.lines.map((l) => l.id)).toEqual(["1"]);
  });

  it("never emits an อื่นๆ group when every line is categorized", () => {
    const lines: L[] = [
      { id: "1", categoryId: "cat-a" },
      { id: "2", categoryId: "cat-b" },
    ];
    const groups = groupLinesByCategory(lines, categories);
    expect(groups.some((g) => g.categoryId === null)).toBe(false);
  });
});
