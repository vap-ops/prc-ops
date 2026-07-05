// Writing failing test first.
//
// Spec 264 G4 — the approve action passes the SELECTED role to
// approve_staff_registration (not the G1 hard-coded 'technician' stopgap). The
// action still gates the role client-side against STAFF_ONBOARDABLE_ROLES (the
// RPC re-guards server-side regardless); the default the UI sends is 'technician'
// (the common case + the current entry link). Role/session gate + the rpc call
// are mocked — this pins the wiring, not the DB.

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

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: { supabase: { rpc }, user: { id: "approver-1" } },
    role: "procurement_manager",
  });
  rpc.mockReset().mockResolvedValue({ data: "worker-1", error: null });
});

describe("approveStaffRegistration — spec 264 G4 role selector wiring", () => {
  it("passes the SELECTED role to approve_staff_registration (not hard-coded technician)", async () => {
    const r = await approveStaffRegistration({ registrationId: REG, role: "accounting" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "accounting",
    });
  });

  it("passes technician when technician is chosen (the default case)", async () => {
    const r = await approveStaffRegistration({ registrationId: REG, role: "technician" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "technician",
    });
  });

  it("refuses a role outside STAFF_ONBOARDABLE_ROLES before calling the RPC", async () => {
    // site_owner is deliberately excluded from the onboard list (promotion path,
    // ADR 0060) — the client-side gate rejects it; the RPC is never reached.
    const r = await approveStaffRegistration({ registrationId: REG, role: "site_owner" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a non-assignable role (super_admin) before calling the RPC", async () => {
    const r = await approveStaffRegistration({ registrationId: REG, role: "super_admin" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still refuses an invalid registration id before any RPC call", async () => {
    const r = await approveStaffRegistration({ registrationId: "not-a-uuid", role: "technician" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
