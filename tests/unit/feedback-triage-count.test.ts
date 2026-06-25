// Spec 201 (awareness arc A1) — the open-feedback head-count behind the operator's
// /dashboard triage card. Best-effort: a read error yields 0 (never blocks the
// dashboard), mirroring getPendingBankChangeCount. The card's presentation is pinned
// by awareness-card.test.tsx; this pins the count read + its query shape.

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { getOpenFeedbackCount } from "@/lib/feedback/triage-count";

// Minimal fake of the supabase head-count chain:
// from(table).select(cols, { count, head }).eq(col, val) resolves to { count, error }.
// Records the call so the test asserts the query shape (right table + status='open').
function fakeSupabase(result: { count: number | null; error: unknown }) {
  const calls = {
    table: "",
    selectArgs: [] as unknown[],
    eq: { col: "", val: undefined as unknown },
  };
  const eq = vi.fn((col: string, val: unknown) => {
    calls.eq = { col, val };
    return Promise.resolve(result);
  });
  const select = vi.fn((...args: unknown[]) => {
    calls.selectArgs = args;
    return { eq };
  });
  const from = vi.fn((table: string) => {
    calls.table = table;
    return { select };
  });
  return { client: { from } as unknown as SupabaseClient<Database>, calls };
}

describe("getOpenFeedbackCount", () => {
  it("head-counts open feedback and returns the count", async () => {
    const { client, calls } = fakeSupabase({ count: 3, error: null });
    expect(await getOpenFeedbackCount(client)).toBe(3);
    expect(calls.table).toBe("feedback");
    expect(calls.eq).toEqual({ col: "status", val: "open" });
    expect(calls.selectArgs[0]).toBe("id");
    expect(calls.selectArgs[1]).toMatchObject({ count: "exact", head: true });
  });

  it("returns 0 when the read errors (best-effort, never blocks the dashboard)", async () => {
    const { client } = fakeSupabase({ count: 5, error: new Error("rls/db down") });
    expect(await getOpenFeedbackCount(client)).toBe(0);
  });

  it("returns 0 when the count is null", async () => {
    const { client } = fakeSupabase({ count: null, error: null });
    expect(await getOpenFeedbackCount(client)).toBe(0);
  });
});
