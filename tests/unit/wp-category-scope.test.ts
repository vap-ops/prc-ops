// Spec 289 U1 — loadWpCategoryScope: the WP-detail page's category chain
// (project_categories row → resolveScopedCategories), extracted so it can ride
// the page's big Promise.all instead of running as a post-batch serial tail.
// RED first: the module does not exist yet.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/catalog/scoped-categories", () => ({
  resolveScopedCategories: vi.fn(async () => [
    { categoryId: "mc1", kindFilter: null },
    { categoryId: "mc2", kindFilter: "material" },
  ]),
}));

import { loadWpCategoryScope } from "@/lib/catalog/wp-category-scope";
import { resolveScopedCategories } from "@/lib/catalog/scoped-categories";

type CategoryRow = {
  name: string;
  work_category_id: string | null;
  work_categories: { code: string } | { code: string }[] | null;
} | null;

function makeSupabase(row: CategoryRow) {
  const calls: string[] = [];
  const selects: string[] = [];
  const q = {
    select: (cols: string) => {
      selects.push(cols);
      return q;
    },
    eq: () => q,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return {
    client: {
      from: (table: string) => {
        calls.push(table);
        return q;
      },
    } as never,
    calls,
    selects,
  };
}

describe("loadWpCategoryScope", () => {
  it("returns empty scope and makes NO db call when categoryId is null", async () => {
    const { client, calls } = makeSupabase(null);
    const scope = await loadWpCategoryScope(client, null);
    expect(scope).toEqual({ workCategoryName: null, workCategoryCode: null, scopedRelation: [] });
    expect(calls).toEqual([]);
  });

  it("resolves name + code + scoped relation for a reconciled category", async () => {
    const { client, calls, selects } = makeSupabase({
      name: "งานโครงสร้าง",
      work_category_id: "wc1",
      work_categories: { code: "S" },
    });
    const scope = await loadWpCategoryScope(client, "cat1");
    // Behavior-preserving contract: the SAME table + column list the page's
    // inline version read (specs 226/229/277).
    expect(calls).toEqual(["project_categories"]);
    expect(selects).toEqual(["name, work_category_id, work_categories(code)"]);
    expect(scope.workCategoryName).toBe("งานโครงสร้าง");
    expect(scope.workCategoryCode).toBe("S");
    expect(scope.scopedRelation).toEqual([
      { categoryId: "mc1", kindFilter: null },
      { categoryId: "mc2", kindFilter: "material" },
    ]);
    expect(vi.mocked(resolveScopedCategories)).toHaveBeenCalledWith(expect.anything(), "wc1");
  });

  it("handles the array-shaped work_categories relation", async () => {
    const { client } = makeSupabase({
      name: "งานระบบ",
      work_category_id: "wc2",
      work_categories: [{ code: "E" }],
    });
    const scope = await loadWpCategoryScope(client, "cat2");
    expect(scope.workCategoryCode).toBe("E");
  });

  it("returns name but empty scope for an unreconciled category (no work_category_id)", async () => {
    const { client } = makeSupabase({
      name: "หมวดอิสระ",
      work_category_id: null,
      work_categories: null,
    });
    const scope = await loadWpCategoryScope(client, "cat3");
    expect(scope).toEqual({
      workCategoryName: "หมวดอิสระ",
      workCategoryCode: null,
      scopedRelation: [],
    });
  });

  it("returns all-null scope when the category row is missing", async () => {
    const { client } = makeSupabase(null);
    const scope = await loadWpCategoryScope(client, "cat-gone");
    expect(scope).toEqual({ workCategoryName: null, workCategoryCode: null, scopedRelation: [] });
  });
});
