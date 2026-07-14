// Writing failing test first.
//
// DC edit matrix — reachability. decideWorkerBankChange (approve/reject a WORKER's
// portal-submitted bank change) widens beyond PM_ROLES to also admit
// procurement_manager, mirroring the widened decide_worker_bank_change RPC gate
// (procurement_manager owns ช่าง onboarding). Plain procurement stays OUT
// (it is a buyer, not an approver of worker money — same boundary as the RPC).

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

import { decideWorkerBankChange } from "@/lib/portal/actions";

const REQ = "11111111-1111-4111-8111-111111111111";
const REVALIDATE = "/contacts/bank-changes";

function asRole(role: string) {
  maybeSingle.mockResolvedValue({ data: { role } });
}

beforeEach(() => {
  maybeSingle.mockReset();
  rpc.mockReset().mockResolvedValue({ error: null });
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

describe("decideWorkerBankChange gate — DC edit matrix reachability", () => {
  it("allows procurement_manager to decide (relays to the RPC)", async () => {
    asRole("procurement_manager");
    const r = await decideWorkerBankChange({ id: REQ, approve: true, revalidate: REVALIDATE });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("decide_worker_bank_change", { p_id: REQ, p_approve: true });
  });

  it("still allows a project_manager", async () => {
    asRole("project_manager");
    const r = await decideWorkerBankChange({ id: REQ, approve: false, revalidate: REVALIDATE });
    expect(r).toEqual({ ok: true });
  });

  it("rejects plain procurement (buyer, not an approver of worker money)", async () => {
    asRole("procurement");
    const r = await decideWorkerBankChange({ id: REQ, approve: true, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects site_admin", async () => {
    asRole("site_admin");
    const r = await decideWorkerBankChange({ id: REQ, approve: true, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
