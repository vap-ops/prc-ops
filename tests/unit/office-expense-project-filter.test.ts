// Spec 323 U4 — the /expenses surface gains the universal project lens. These
// tests pin the loaders' scoping seam: an active ?project= becomes a DB
// predicate (.eq("project_id", …)) on the caller's own list, the finance
// reimburse queue, AND both summary reads — and an unscoped call adds none, so
// the default ทุกโครงการ view is byte-identical to the pre-lens page.

import { describe, expect, it, vi } from "vitest";

import {
  listMyExpenses,
  listReimbursableExpenses,
  loadMyExpenseSummary,
} from "@/lib/expenses/load-office-expenses";

type Call = { method: string; args: unknown[] };

// Chainable PostgREST-builder recorder: every filter/modifier returns the
// builder, awaiting it resolves empty data — enough to pin WHICH predicates
// each loader applies without a live client.
function recordingClient() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (v: { data: never[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  };
  for (const m of ["select", "eq", "neq", "is", "not", "gte", "lt", "order", "limit"]) {
    builder[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    });
  }
  const from = vi.fn(() => builder);
  const supabase = { from } as unknown as Parameters<typeof listMyExpenses>[0];
  return { supabase, calls };
}

const projectEqs = (calls: Call[]) =>
  calls.filter((c) => c.method === "eq" && c.args[0] === "project_id");

describe("spec 323 U4 — office-expense loaders under the project lens", () => {
  it("listMyExpenses scopes to the project when one is active", async () => {
    const { supabase, calls } = recordingClient();
    await listMyExpenses(supabase, "u1", "p1");
    expect(projectEqs(calls)).toEqual([{ method: "eq", args: ["project_id", "p1"] }]);
    // The own-rows predicate is untouched.
    expect(calls).toContainEqual({ method: "eq", args: ["submitted_by", "u1"] });
  });

  it("listMyExpenses adds NO project predicate by default (ทุกโครงการ)", async () => {
    const { supabase, calls } = recordingClient();
    await listMyExpenses(supabase, "u1");
    expect(projectEqs(calls)).toEqual([]);
  });

  it("listReimbursableExpenses scopes to the project when one is active", async () => {
    const { supabase, calls } = recordingClient();
    await listReimbursableExpenses(supabase, "p1");
    expect(projectEqs(calls)).toEqual([{ method: "eq", args: ["project_id", "p1"] }]);
  });

  it("listReimbursableExpenses adds NO project predicate by default", async () => {
    const { supabase, calls } = recordingClient();
    await listReimbursableExpenses(supabase);
    expect(projectEqs(calls)).toEqual([]);
  });

  it("loadMyExpenseSummary scopes BOTH reads (month spend + pending reimburse)", async () => {
    const { supabase, calls } = recordingClient();
    await loadMyExpenseSummary(supabase, "u1", "p1");
    expect(projectEqs(calls)).toEqual([
      { method: "eq", args: ["project_id", "p1"] },
      { method: "eq", args: ["project_id", "p1"] },
    ]);
  });

  it("loadMyExpenseSummary adds NO project predicate by default", async () => {
    const { supabase, calls } = recordingClient();
    await loadMyExpenseSummary(supabase, "u1");
    expect(projectEqs(calls)).toEqual([]);
  });
});
