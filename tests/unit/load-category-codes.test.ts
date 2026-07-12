// Writing failing test first.
//
// Spec 301 U1 — loadCategoryCodeById: the batch project-category → global
// work-category letter-code reconcile, extracted to ONE shared helper so the
// purchasing surfaces don't add a 5th copy of the page-inline pattern
// (projects/[projectId], /sa, /sa/crew, /sa/plan all carry it inline today).
// Contract: distinct ids in one `.in()` read; the `work_categories` embed
// arrives object- OR array-shaped depending on FK inference (same guard as
// loadWpCategoryScope); unreconciled categories are omitted; empty input
// issues NO query.

import { describe, expect, it } from "vitest";

import { loadCategoryCodeById } from "@/lib/work-categories/load-category-codes";

type Row = Record<string, unknown>;
type FakeCall = { table: string; method: string; args: unknown[] };

function fakeClient(rows: Row[]) {
  const calls: FakeCall[] = [];
  const from = (table: string) => {
    const b: Record<string, unknown> = {
      select: (...a: unknown[]) => (calls.push({ table, method: "select", args: a }), b),
      in: (...a: unknown[]) => (calls.push({ table, method: "in", args: a }), b),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    };
    return b;
  };
  return { client: { from } as never, calls };
}

describe("loadCategoryCodeById", () => {
  it("maps project-category ids to reconciled work-category codes (object-shaped embed)", async () => {
    const { client } = fakeClient([
      { id: "pc1", work_categories: { code: "W05" } },
      { id: "pc2", work_categories: { code: "W02" } },
    ]);
    const map = await loadCategoryCodeById(client, ["pc1", "pc2"]);
    expect(map.get("pc1")).toBe("W05");
    expect(map.get("pc2")).toBe("W02");
  });

  it("accepts the array-shaped embed and omits unreconciled categories", async () => {
    const { client } = fakeClient([
      { id: "pc1", work_categories: [{ code: "W07" }] },
      { id: "pc2", work_categories: null },
    ]);
    const map = await loadCategoryCodeById(client, ["pc1", "pc2"]);
    expect(map.get("pc1")).toBe("W07");
    expect(map.has("pc2")).toBe(false);
  });

  it("dedupes ids into one .in() read", async () => {
    const { client, calls } = fakeClient([{ id: "pc1", work_categories: { code: "W01" } }]);
    await loadCategoryCodeById(client, ["pc1", "pc1", "pc1"]);
    const inCall = calls.find((c) => c.method === "in");
    expect(inCall?.args[1]).toEqual(["pc1"]);
    expect(calls.filter((c) => c.method === "select")).toHaveLength(1);
  });

  it("issues no query for empty input", async () => {
    const { client, calls } = fakeClient([]);
    const map = await loadCategoryCodeById(client, []);
    expect(map.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
