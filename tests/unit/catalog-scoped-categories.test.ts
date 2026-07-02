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
  resolveWorkCategoryScopes,
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

// Perf debt rank 4 (architecture audit 2026-06) — the supply-plan page resolved
// each distinct work-category SERIALLY in a for-loop. resolveWorkCategoryScopes
// fans the per-work-category reads out CONCURRENTLY and returns the
// workCategoryId -> [categoryId...] map the page previously built by hand.
// Same data, same show-all fallback (unmapped ids are OMITTED from the map).
describe("resolveWorkCategoryScopes (waterfall fix)", () => {
  type Deferred = {
    resolve: (v: { data: Row[] | null; error: null }) => void;
  };

  // Stub where each .eq() call returns a promise WE resolve — lets the test
  // observe whether all queries were issued before any single one completed.
  function stubDeferredSupabase() {
    const deferreds: Deferred[] = [];
    const eq = vi.fn(
      () =>
        new Promise<{ data: Row[] | null; error: null }>((resolve) => {
          deferreds.push({ resolve });
        }),
    );
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return {
      client: { from } as unknown as Parameters<typeof resolveScopedCategories>[0],
      deferreds,
      spies: { eq },
    };
  }

  it("issues every distinct work-category read before any completes (concurrent, not serial)", async () => {
    const { client, deferreds, spies } = stubDeferredSupabase();
    const pending = resolveWorkCategoryScopes(client, ["wc-a", "wc-b", "wc-c"]);

    // Flush microtasks WITHOUT resolving any query: a serial loop would have
    // issued only the first read; the concurrent fan-out issues all three.
    await Promise.resolve();
    expect(spies.eq).toHaveBeenCalledTimes(3);

    deferreds[0]!.resolve({ data: [{ category_id: "cat-01", kind_filter: null }], error: null });
    deferreds[1]!.resolve({ data: [{ category_id: "cat-02", kind_filter: null }], error: null });
    deferreds[2]!.resolve({ data: [], error: null });
    const map = await pending;
    expect(map.get("wc-a")).toEqual(["cat-01"]);
    expect(map.get("wc-b")).toEqual(["cat-02"]);
  });

  it("resolves each DISTINCT id once (duplicates collapse) and dedups category ids", async () => {
    const { client, deferreds, spies } = stubDeferredSupabase();
    const pending = resolveWorkCategoryScopes(client, ["wc-a", "wc-a", "wc-b"]);
    await Promise.resolve();
    expect(spies.eq).toHaveBeenCalledTimes(2);

    deferreds[0]!.resolve({
      data: [
        { category_id: "cat-01", kind_filter: null },
        { category_id: "cat-01", kind_filter: "tool" },
        { category_id: "cat-08", kind_filter: null },
      ],
      error: null,
    });
    deferreds[1]!.resolve({ data: [{ category_id: "cat-02", kind_filter: null }], error: null });
    const map = await pending;
    expect(map.get("wc-a")).toEqual(["cat-01", "cat-08"]);
    expect(map.get("wc-b")).toEqual(["cat-02"]);
  });

  it("omits unmapped work-categories from the map (show-all fallback preserved)", async () => {
    const { client, deferreds } = stubDeferredSupabase();
    const pending = resolveWorkCategoryScopes(client, ["wc-mapped", "wc-unmapped"]);
    await Promise.resolve();
    deferreds[0]!.resolve({ data: [{ category_id: "cat-01", kind_filter: null }], error: null });
    deferreds[1]!.resolve({ data: [], error: null });
    const map = await pending;
    expect(map.has("wc-unmapped")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("returns an empty map for no ids without issuing any read", async () => {
    const { client, spies } = stubDeferredSupabase();
    const map = await resolveWorkCategoryScopes(client, []);
    expect(map.size).toBe(0);
    expect(spies.eq).not.toHaveBeenCalled();
  });
});
