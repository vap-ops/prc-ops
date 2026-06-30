// Writing failing test first.
//
// Spec 239 U2 (ADR 0066 / C1) — the item form's multi-category control
// ("ปรากฏในหมวดอื่นด้วย") writes SECONDARY catalog_item_categories memberships. On
// save the server action reconciles the item's current secondary set against the
// chosen one: add the new ones, remove the dropped ones. The PRIMARY (canonical
// home) is maintained by update_catalog_item itself, so it is never a secondary.
// This pins the pure diff the action drives (the RPC loop is thin glue over it).

import { describe, expect, it } from "vitest";
import { diffSecondaryMemberships } from "@/lib/catalog/categories";

describe("diffSecondaryMemberships (spec 239 U2)", () => {
  it("adds the desired categories that are not already members", () => {
    const { toAdd, toRemove } = diffSecondaryMemberships(["cA"], ["cA", "cB"], "cP");
    expect(toAdd.sort()).toEqual(["cB"]);
    expect(toRemove).toEqual([]);
  });

  it("removes the current secondaries no longer desired", () => {
    const { toAdd, toRemove } = diffSecondaryMemberships(["cA", "cB"], ["cA"], "cP");
    expect(toAdd).toEqual([]);
    expect(toRemove.sort()).toEqual(["cB"]);
  });

  it("excludes the primary from both add and remove (it is never a secondary)", () => {
    // The primary appears in the desired set (the picker may not strip it) AND in
    // the current rows (a stale row) — neither should drive a secondary write.
    const { toAdd, toRemove } = diffSecondaryMemberships(["cP", "cA"], ["cP", "cB"], "cP");
    expect(toAdd).toEqual(["cB"]);
    expect(toRemove).toEqual(["cA"]);
  });

  it("de-duplicates repeated ids and is a no-op when current equals desired", () => {
    const { toAdd, toRemove } = diffSecondaryMemberships(["cA", "cA", "cB"], ["cB", "cA"], "cP");
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it("on create (no current) adds every desired secondary except the primary", () => {
    const { toAdd, toRemove } = diffSecondaryMemberships([], ["cP", "cA", "cB"], "cP");
    expect(toAdd.sort()).toEqual(["cA", "cB"]);
    expect(toRemove).toEqual([]);
  });
});
