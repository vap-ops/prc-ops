// Spec 373 D2 — listAllExpenses: the firm-wide list for the finance scope.
// Pins the seam facts the fact-check surfaced: NO submitted_by predicate (that
// is the whole point), submitter names resolved via the ADMIN client (users RLS
// is self-read-only for accounting — the authed embed would null every name),
// month bounds as DB predicates, and the 100-row cap.

import { describe, expect, it, vi } from "vitest";

import {
  fetchOfficeExpenseReviewMap,
  listAllExpenses,
  listAllExpensesForExport,
  loadAllExpenseSummary,
  resolveUserNames,
} from "@/lib/expenses/load-office-expenses";

type Call = { method: string; args: unknown[] };

function recordingClient(rowsBySelect: Record<string, unknown[]> = {}) {
  const queries: { table: string; calls: Call[] }[] = [];
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    const entry = { table, calls };
    queries.push(entry);
    const builder: Record<string, unknown> = {
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rowsBySelect[table] ?? [], error: null }),
    };
    for (const m of ["select", "eq", "in", "is", "not", "gte", "lt", "order", "limit", "range"]) {
      builder[m] = vi.fn((...args: unknown[]) => {
        calls.push({ method: m, args });
        return builder;
      });
    }
    return builder;
  });
  return { client: { from } as never, queries };
}

const expenseRow = {
  id: "e1",
  description: "น้ำมัน",
  amount: 500,
  expense_date: "2026-07-01",
  payment_source: "company_card",
  reimbursed_at: null,
  submitted_by: "u-submitter",
  reimburse_to_user_id: null,
  category: { label_th: "เดินทาง" },
  project: { name: "โครงการ A" },
  card: { label: "บัตร 1" },
};

describe("spec 373 D2 — listAllExpenses", () => {
  it("adds NO submitted_by predicate (firm-wide is the point)", async () => {
    const { client, queries } = recordingClient();
    const { client: admin } = recordingClient();
    await listAllExpenses(client, admin, {});
    const expenseQuery = queries.find((q) => q.table === "office_expenses");
    expect(expenseQuery).toBeDefined();
    expect(
      (expenseQuery?.calls ?? []).filter((c) => c.method === "eq" && c.args[0] === "submitted_by"),
    ).toEqual([]);
  });

  it("overfetches cap+1 (the note only shows when a 101st row exists), newest first", async () => {
    const { client, queries } = recordingClient();
    const { client: admin } = recordingClient();
    const { capped } = await listAllExpenses(client, admin, {});
    expect(capped).toBe(false);
    const calls = queries.find((q) => q.table === "office_expenses")?.calls ?? [];
    expect(calls).toContainEqual({ method: "limit", args: [101] });
    expect(calls).toContainEqual({
      method: "order",
      args: ["expense_date", { ascending: false }],
    });
  });

  it("month bounds become DB predicates; absent month adds none", async () => {
    const bounded = recordingClient();
    await listAllExpenses(bounded.client, recordingClient().client, {
      monthStart: "2026-07-01",
      monthEndExclusive: "2026-08-01",
    });
    const calls = bounded.queries.find((q) => q.table === "office_expenses")?.calls ?? [];
    expect(calls).toContainEqual({ method: "gte", args: ["expense_date", "2026-07-01"] });
    expect(calls).toContainEqual({ method: "lt", args: ["expense_date", "2026-08-01"] });

    const unbounded = recordingClient();
    await listAllExpenses(unbounded.client, recordingClient().client, {});
    const uCalls = unbounded.queries.find((q) => q.table === "office_expenses")?.calls ?? [];
    expect(uCalls.filter((c) => c.method === "gte" || c.method === "lt")).toEqual([]);
  });

  it("project lens becomes a DB predicate", async () => {
    const { client, queries } = recordingClient();
    await listAllExpenses(client, recordingClient().client, { projectId: "p1" });
    const calls = queries.find((q) => q.table === "office_expenses")?.calls ?? [];
    expect(calls).toContainEqual({ method: "eq", args: ["project_id", "p1"] });
  });

  it("submitter AND reimburse-target names come from the ADMIN client (users RLS wall)", async () => {
    const authed = recordingClient({
      office_expenses: [expenseRow, { ...expenseRow, id: "e2", reimburse_to_user_id: "u-target" }],
    });
    const admin = recordingClient({
      users: [
        { id: "u-submitter", full_name: "สมชาย ทดสอบ" },
        { id: "u-target", full_name: "สมหญิง เป้าหมาย" },
      ],
    });
    const { rows } = await listAllExpenses(authed.client, admin.client, {});
    // The AUTHED client never touches users (its embed would null every name) …
    expect(authed.queries.some((q) => q.table === "users")).toBe(false);
    // … the admin client resolves exactly the distinct ids seen.
    const adminUsers = admin.queries.find((q) => q.table === "users");
    expect(adminUsers?.calls).toContainEqual({
      method: "in",
      args: ["id", ["u-submitter", "u-target"]],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.submitterName).toBe("สมชาย ทดสอบ");
    expect(rows[0]?.submitterId).toBe("u-submitter");
    expect(rows[1]?.reimburseToName).toBe("สมหญิง เป้าหมาย");
  });

  it("an unknown submitter id degrades to null name, not a crash", async () => {
    const authed = recordingClient({ office_expenses: [expenseRow] });
    const admin = recordingClient({ users: [] });
    const { rows } = await listAllExpenses(authed.client, admin.client, {});
    expect(rows[0]?.submitterName).toBeNull();
  });
});

describe("spec 373 §5 export — fetchOfficeExpenseReviewMap pages past the RPC's 200-clamp", () => {
  it("keeps calling with a moving p_offset until a short page; map carries all pages", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({
      source_id: `id-${i}`,
      review_status: "pending",
      doc_count: 0,
      docs_expected: "expected",
    }));
    const shortPage = [
      { source_id: "id-200", review_status: "verified", doc_count: 2, docs_expected: "expected" },
    ];
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: shortPage, error: null });
    const map = await fetchOfficeExpenseReviewMap({ rpc } as never);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_offset: 0,
      p_source_table: "office_expenses",
    });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_offset: 200 });
    expect(map.size).toBe(201);
    expect(map.get("id-200")).toEqual({
      status: "verified",
      docCount: 2,
      docsExpected: "expected",
    });
  });

  it("throws on an RPC error instead of returning an empty map as truth", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchOfficeExpenseReviewMap({ rpc } as never)).rejects.toThrow(/boom/);
  });
});

describe("spec 373 §5 export — listAllExpensesForExport is UNCAPPED (pages until short)", () => {
  it("uses range paging, no .limit cap, and resolves names via the admin seam", async () => {
    const authed = recordingClient({ office_expenses: [expenseRow] });
    const admin = recordingClient({ users: [{ id: "u-submitter", full_name: "สมชาย ทดสอบ" }] });
    const rows = await listAllExpensesForExport(authed.client, admin.client, {});
    const calls = authed.queries.find((q) => q.table === "office_expenses")?.calls ?? [];
    expect(calls.some((c) => c.method === "range")).toBe(true);
    expect(calls.filter((c) => c.method === "limit")).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.submitterName).toBe("สมชาย ทดสอบ");
  });

  it("actually walks pages: full page → next window advances by the rows RECEIVED", async () => {
    // Two builders, each its own query: page 0 returns a FULL 1000, page 1
    // returns 1 row — the loop must issue range [0,999] then [1000,1999] and
    // concatenate 1001 rows. (fresh-eyes: the single-row fixture broke the
    // loop on iteration 0, so the paging math had zero coverage.)
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ ...expenseRow, id: `e${i}` }));
    let call = 0;
    const pages = [fullPage, [{ ...expenseRow, id: "e-last" }]];
    const queries: { table: string; calls: { method: string; args: unknown[] }[] }[] = [];
    const from = (table: string) => {
      const calls: { method: string; args: unknown[] }[] = [];
      queries.push({ table, calls });
      const builder: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: pages[call++] ?? [], error: null }),
      };
      for (const m of ["select", "eq", "gte", "lt", "order", "range"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push({ method: m, args });
          return builder;
        };
      }
      return builder;
    };
    const admin = recordingClient({ users: [] });
    const rows = await listAllExpensesForExport({ from } as never, admin.client, {});
    expect(rows).toHaveLength(1001);
    const ranges = queries.flatMap((q) => q.calls.filter((c) => c.method === "range"));
    expect(ranges.map((r) => r.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("month + project filters become DB predicates, same as the list", async () => {
    const authed = recordingClient();
    await listAllExpensesForExport(authed.client, recordingClient().client, {
      projectId: "p1",
      monthStart: "2026-07-01",
      monthEndExclusive: "2026-08-01",
    });
    const calls = authed.queries.find((q) => q.table === "office_expenses")?.calls ?? [];
    expect(calls).toContainEqual({ method: "eq", args: ["project_id", "p1"] });
    expect(calls).toContainEqual({ method: "gte", args: ["expense_date", "2026-07-01"] });
    expect(calls).toContainEqual({ method: "lt", args: ["expense_date", "2026-08-01"] });
  });
});

describe("spec 373 D5 amendment — resolveUserNames (the shared admin seam)", () => {
  it("resolves distinct ids in one query; empty input makes NO query", async () => {
    const admin = recordingClient({ users: [{ id: "u1", full_name: "ชื่อจริง" }] });
    const names = await resolveUserNames(admin.client, ["u1", "u1"]);
    expect(admin.queries.find((q) => q.table === "users")?.calls).toContainEqual({
      method: "in",
      args: ["id", ["u1"]],
    });
    expect(names.get("u1")).toBe("ชื่อจริง");

    const idle = recordingClient();
    await resolveUserNames(idle.client, []);
    expect(idle.queries).toHaveLength(0);
  });
});

describe("spec 373 D3 — loadAllExpenseSummary", () => {
  it("is firm-wide: NO per-user predicate on either query; pending = target set + unpaid", async () => {
    const { client, queries } = recordingClient();
    await loadAllExpenseSummary(client, {});
    expect(queries).toHaveLength(2);
    for (const q of queries) {
      expect(
        q.calls.filter(
          (c) =>
            c.method === "eq" &&
            (c.args[0] === "submitted_by" || c.args[0] === "reimburse_to_user_id"),
        ),
      ).toEqual([]);
    }
    const pend = queries[1]?.calls ?? [];
    expect(pend).toContainEqual({ method: "not", args: ["reimburse_to_user_id", "is", null] });
    expect(pend).toContainEqual({ method: "is", args: ["reimbursed_at", null] });
  });

  it("month bounds scope the spend query (never the pending figure — debt has no month)", async () => {
    const { client, queries } = recordingClient();
    await loadAllExpenseSummary(client, {
      monthStart: "2026-07-01",
      monthEndExclusive: "2026-08-01",
    });
    const spend = queries[0]?.calls ?? [];
    expect(spend).toContainEqual({ method: "gte", args: ["expense_date", "2026-07-01"] });
    expect(spend).toContainEqual({ method: "lt", args: ["expense_date", "2026-08-01"] });
    const pend = queries[1]?.calls ?? [];
    expect(pend.filter((c) => c.method === "gte" || c.method === "lt")).toEqual([]);
  });

  it("aggregates spend by category AND by payment source", async () => {
    const { client } = recordingClient({
      office_expenses: [
        { amount: 400, payment_source: "company_card", category: { label_th: "เดินทาง" } },
        { amount: 100, payment_source: "own_money", category: { label_th: "รับรอง" } },
      ],
    });
    const summary = await loadAllExpenseSummary(client, {});
    expect(summary.monthTotal).toBe(500);
    expect(summary.bySource).toEqual([
      { source: "company_card", total: 400 },
      { source: "own_money", total: 100 },
    ]);
    expect(summary.byCategory.map((c) => c.label)).toEqual(["เดินทาง", "รับรอง"]);
  });
});
