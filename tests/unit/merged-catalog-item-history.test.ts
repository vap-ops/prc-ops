// Writing failing test first.
//
// Spec 344 U1b — a merged-away catalog row keeps its append-only ledger.
//
// merge_catalog_items folds the loser's balance into the survivor but CANNOT move
// its stock_receipts / stock_issues / stock_counts / stock_returns / stock_reversals
// rows: those tables raise P0001 on any UPDATE ("append-only, correct via reversal,
// never mutate"). So the survivor's item page would show 316 เส้น on hand and a
// movement list explaining only 158 of them — a balance with no history.
//
// The cure is `catalog_items.merged_into`: every reader keyed on catalog_item_id
// resolves the id to {id} ∪ {x : x.merged_into = id} first.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { mergedItemIds } from "@/lib/store/merged-item-ids";

const PAGE = join(
  process.cwd(),
  "src/app/projects/[projectId]/store/items/[catalogItemId]/page.tsx",
);
const pageSource = readFileSync(PAGE, "utf8");
const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("spec 344 U1b — the survivor's page reads the merged row's history", () => {
  it("resolves to the item itself plus every row merged into it", () => {
    expect(mergedItemIds("keep", [{ id: "flat-a" }, { id: "flat-b" }])).toEqual([
      "keep",
      "flat-a",
      "flat-b",
    ]);
  });

  it("is the identity for an item nothing was merged into", () => {
    expect(mergedItemIds("keep", [])).toEqual(["keep"]);
    expect(mergedItemIds("keep", null)).toEqual(["keep"]);
  });

  it("never repeats an id, so .in() cannot double-count a movement", () => {
    expect(mergedItemIds("keep", [{ id: "keep" }, { id: "flat" }, { id: "flat" }])).toEqual([
      "keep",
      "flat",
    ]);
  });

  it("the item-detail page resolves the id set rather than trusting the route param", () => {
    // Import line PLUS at least one real call — a bare toContain would pass on
    // the import alone.
    expect(occurrences(pageSource, "mergedItemIds")).toBeGreaterThanOrEqual(2);
  });

  it("every ledger query filters on the id SET, and the single-id match object is gone", () => {
    // stock_receipts, stock_issues, stock_counts, stock_returns, stock_reversals.
    expect(occurrences(pageSource, '.in("catalog_item_id"')).toBeGreaterThanOrEqual(5);
    expect(pageSource).not.toContain("catalog_item_id: catalogItemId");
  });

  it("names where the merged history came from, so the older rows are attributable", () => {
    expect(pageSource).toContain("รวมมาจาก");
  });
});
