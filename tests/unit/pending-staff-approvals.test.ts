// Writing failing test first.
//
// Spec 396 U4 — the pending head-count behind the dashboard's STAFF-APPROVAL card.
//
// Why this reader exists at all: `/contacts/bank-changes` decides FOUR kinds, and the
// dashboard only ever counted two of them (contractor + worker bank). `AwarenessCard`
// returns null at count<=0, so with contractor=0 and worker=0 the card did not render
// and the queue had NO DOOR — while 4 identity requests sat pending for up to 20 days
// and the page's own route telemetry showed its last visit was the day BEFORE the
// oldest of them arrived.
//
// It is a SEPARATE reader from getPendingBankChangeCount on purpose: the live RLS read
// arms differ. contractor/worker bank = PM_ROLES (project_manager, super_admin,
// project_director); identity/staff_bank = STAFF_APPROVAL_ROLES (procurement_manager,
// project_director, super_admin) — the same trio the page gates `canSeeTrioKinds` on.
// Summing the two families into one card would break the gate AND make the existing
// label ("การเปลี่ยนบัญชีรอการอนุมัติ" — BANK changes) untrue.
//
// Best-effort per kind: a read error contributes 0 rather than blocking the dashboard,
// mirroring getPendingBankChangeCount / getOpenFeedbackCount.

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { getPendingStaffApprovalCount } from "@/lib/approvals/pending-staff-approvals";

type Result = { count: number | null; error: unknown };

// Minimal fake of the supabase head-count chain, per table:
// from(table).select(cols, { count, head }).eq(col, val) resolves to { count, error }.
// Records every call so the test asserts the query SHAPE (right tables + status filter),
// not merely the returned number.
function fakeSupabase(results: Record<string, Result>) {
  const calls: Record<string, { selectArgs: unknown[]; eq: { col: string; val: unknown } }> = {};
  const from = vi.fn((table: string) => ({
    select: vi.fn((...selectArgs: unknown[]) => ({
      eq: vi.fn((col: string, val: unknown) => {
        calls[table] = { selectArgs, eq: { col, val } };
        return Promise.resolve(results[table] ?? { count: 0, error: null });
      }),
    })),
  }));
  return { client: { from } as unknown as SupabaseClient<Database>, calls, from };
}

const IDENTITY = "identity_change_requests";
const STAFF_BANK = "staff_bank_change_requests";

describe("getPendingStaffApprovalCount", () => {
  it("sums the pending identity and staff-bank requests", async () => {
    const { client } = fakeSupabase({
      [IDENTITY]: { count: 4, error: null },
      [STAFF_BANK]: { count: 2, error: null },
    });
    expect(await getPendingStaffApprovalCount(client)).toBe(6);
  });

  // The filter is the thing that silently rots: without it the card becomes a
  // permanent alarm nobody can clear, counting every request ever decided.
  it("head-counts BOTH tables filtered to status='pending'", async () => {
    const { client, calls } = fakeSupabase({
      [IDENTITY]: { count: 4, error: null },
      [STAFF_BANK]: { count: 2, error: null },
    });
    await getPendingStaffApprovalCount(client);

    for (const table of [IDENTITY, STAFF_BANK]) {
      expect(calls[table], `${table} was never read`).toBeDefined();
      expect(calls[table].eq).toEqual({ col: "status", val: "pending" });
      expect(calls[table].selectArgs[0]).toBe("id");
      expect(calls[table].selectArgs[1]).toMatchObject({ count: "exact", head: true });
    }
  });

  // Per-kind best effort: one kind failing must not zero the other, or a transient
  // RLS/db blip on the quieter table hides the requests that ARE waiting.
  it("counts the healthy kind when the other read errors", async () => {
    const { client } = fakeSupabase({
      [IDENTITY]: { count: 4, error: null },
      [STAFF_BANK]: { count: 9, error: new Error("rls/db down") },
    });
    expect(await getPendingStaffApprovalCount(client)).toBe(4);

    const flipped = fakeSupabase({
      [IDENTITY]: { count: 9, error: new Error("rls/db down") },
      [STAFF_BANK]: { count: 2, error: null },
    });
    expect(await getPendingStaffApprovalCount(flipped.client)).toBe(2);
  });

  it("returns 0 when both reads error", async () => {
    const { client } = fakeSupabase({
      [IDENTITY]: { count: 4, error: new Error("down") },
      [STAFF_BANK]: { count: 2, error: new Error("down") },
    });
    expect(await getPendingStaffApprovalCount(client)).toBe(0);
  });

  it("treats a null count as 0", async () => {
    const { client } = fakeSupabase({
      [IDENTITY]: { count: null, error: null },
      [STAFF_BANK]: { count: null, error: null },
    });
    expect(await getPendingStaffApprovalCount(client)).toBe(0);
  });
});
