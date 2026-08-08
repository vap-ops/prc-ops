// Writing failing test first.
//
// decideIdentityChange maps an RPC error to Thai copy. Behavioral coverage for
// that mapping was missing entirely (only the pure dobRefusalFact/
// identityDuplicateTaxIdFact helpers had unit tests) — pin the WIRING here so a
// future edit can't silently drop an error arm back to the generic transient
// copy, the exact defect this fix addresses (workers_tax_id_unique 23505 on
// approve fell through to "ลองใหม่อีกครั้อง").

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, applyAssumedRole, maybeSingle, rpc } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  applyAssumedRole: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({ getActionUser, NOT_SIGNED_IN: "not signed in" }));
vi.mock("@/lib/auth/apply-assumed-role", () => ({ applyAssumedRole }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { decideIdentityChange } from "@/lib/portal/actions";

const REQ = "11111111-1111-4111-8111-111111111111";
const REVALIDATE = "/contacts/bank-changes";

beforeEach(() => {
  maybeSingle.mockReset().mockResolvedValue({ data: { role: "super_admin" } });
  applyAssumedRole
    .mockReset()
    .mockImplementation(async (r: string | null | undefined) => r ?? null);
  getActionUser.mockReset().mockResolvedValue({
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
      rpc,
    },
    user: { id: "u1" },
  });
});

describe("decideIdentityChange error mapping", () => {
  it("names a workers_tax_id_unique collision as permanent, not the generic retry copy", async () => {
    rpc.mockReset().mockResolvedValue({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "workers_tax_id_unique"',
      },
    });
    const r = await decideIdentityChange({ id: REQ, approve: true, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("มีอยู่แล้ว");
    expect(r.error).not.toContain("ลองใหม่อีกครั้ง");
  });

  it("still maps a DOB refusal to its own fact (regression pin)", async () => {
    rpc.mockReset().mockResolvedValue({
      error: { code: "P0001", message: "workers.date_of_birth: dob under minimum age" },
    });
    const r = await decideIdentityChange({ id: REQ, approve: true, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("อายุไม่ถึง");
  });

  it("falls back to the generic copy for an unrelated 23505", async () => {
    rpc.mockReset().mockResolvedValue({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "some_other_key"',
      },
    });
    const r = await decideIdentityChange({ id: REQ, approve: true, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("ลองใหม่อีกครั้ง");
  });

  it("succeeds and revalidates when the RPC has no error", async () => {
    rpc.mockReset().mockResolvedValue({ error: null });
    const r = await decideIdentityChange({ id: REQ, approve: true, revalidate: REVALIDATE });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("decide_identity_change", { p_id: REQ, p_approve: true });
  });
});
