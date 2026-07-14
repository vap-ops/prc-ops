// Writing failing test first.
//
// Spec 301 U2 — prCategoryMatch: the approver-side recompute of the picker's
// off-category flag (spec 297 deferred it because the PR stores no category).
// Semantics = EXACTLY the PR picker's (scopeCatalogItems, category-only UC1):
//   match     → the item's canonical∪secondary categories intersect the WP scope
//   mismatch  → active scope, no intersection
//   null      → no flag: free-text PR (no item), or no active scope (WP-less /
//               uncategorised WP / unreconciled / empty Relation-R) — the
//               picker's scopeActive gating.

import { describe, expect, it } from "vitest";

import { prCategoryMatch } from "@/lib/purchasing/pr-category-match";

const MEMBERSHIPS = new Map<string, Set<string>>([["item2", new Set(["catB"])]]);

describe("prCategoryMatch (spec 301 U2)", () => {
  it("returns match when the item's canonical category is in scope", () => {
    expect(
      prCategoryMatch({ id: "item1", categoryId: "catA" }, MEMBERSHIPS, ["catA", "catC"]),
    ).toBe("match");
  });

  it("returns match via a SECONDARY membership (canonical out of scope)", () => {
    expect(prCategoryMatch({ id: "item2", categoryId: "catZ" }, MEMBERSHIPS, ["catB"])).toBe(
      "match",
    );
  });

  it("returns mismatch when no category intersects an active scope", () => {
    expect(prCategoryMatch({ id: "item1", categoryId: "catZ" }, MEMBERSHIPS, ["catA"])).toBe(
      "mismatch",
    );
  });

  it("returns null for a free-text PR (no catalog item)", () => {
    expect(prCategoryMatch(null, MEMBERSHIPS, ["catA"])).toBeNull();
  });

  it("returns null when the scope is empty or absent (show-all fallback — no flag)", () => {
    expect(prCategoryMatch({ id: "item1", categoryId: "catA" }, MEMBERSHIPS, [])).toBeNull();
    expect(prCategoryMatch({ id: "item1", categoryId: "catA" }, MEMBERSHIPS, null)).toBeNull();
  });

  it("returns mismatch for an uncategorised ITEM under an active scope (picker parity)", () => {
    expect(prCategoryMatch({ id: "item9", categoryId: null }, MEMBERSHIPS, ["catA"])).toBe(
      "mismatch",
    );
  });
});
