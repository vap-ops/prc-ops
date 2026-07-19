// Writing failing test first.
//
// Spec 328 U3 — the approve action forwards the approver's confirmed firm as
// p_contractor_id to approve_staff_registration (live 6-arg signature, mig
// 075815). The RPC owns the authoritative guards (firm existence, role forced
// technician, bank-floor carve) — this pins the wiring only: (1) a selected
// firm id is forwarded verbatim, (2) an absent/blank firm OMITS the key (the
// generated arg type is `p_contractor_id?: string`; SQL default null), (3) a
// malformed firm id is rejected before the RPC is ever called.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, rpc } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "not signed in",
  NOT_PERMITTED: "ไม่มีสิทธิ์ทำรายการนี้",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { approveStaffRegistration } from "@/app/registrations/actions";

const REG = "11111111-1111-4111-8111-111111111111";
const FIRM = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: { supabase: { rpc }, user: { id: "approver-1" } },
    role: "procurement_manager",
  });
  rpc.mockReset().mockResolvedValue({ data: "worker-1", error: null });
});

describe("approveStaffRegistration — firm pass-through (spec 328 U3)", () => {
  it("forwards the confirmed firm id as p_contractor_id", async () => {
    const r = await approveStaffRegistration({
      registrationId: REG,
      role: "technician",
      projectId: null,
      contractorId: FIRM,
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "technician",
      p_contractor_id: FIRM,
    });
  });

  it("omits p_contractor_id when no firm is selected (null)", async () => {
    const r = await approveStaffRegistration({
      registrationId: REG,
      role: "technician",
      projectId: null,
      contractorId: null,
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "technician",
    });
  });

  it("rejects a malformed firm id before calling the RPC", async () => {
    const r = await approveStaffRegistration({
      registrationId: REG,
      role: "technician",
      projectId: null,
      contractorId: "not-a-uuid",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
