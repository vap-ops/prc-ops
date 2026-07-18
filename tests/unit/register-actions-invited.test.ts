// Writing failing test first.
//
// Spec 279 F2b — startStaffRegistration forwards the SA-QR's invited_by (?by) +
// invited_project_id (?project) to start_staff_registration as p_invited_by /
// p_invited_project_id, but ONLY when they are UUID-shaped. The params are read
// off a URL (attacker-controllable), and the RPC args are typed `uuid`, so a
// malformed value must be DROPPED at the action boundary — never sent — else the
// RPC call would 22P02 and block a legitimate applicant. A well-formed-but-forged
// uuid still reaches the RPC, where the DEFINER body existence-coerces it to NULL
// (covered by the pgTAP test). Session/rpc mocked — this pins the wiring.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({ getActionUser: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { startStaffRegistration } from "@/lib/register/actions";

const SA = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc }, user: { id: "visitor-1" } });
  rpc.mockReset().mockResolvedValue({ data: "PRC-26-0009", error: null });
});

describe("startStaffRegistration — spec 279 F2b invite attribution", () => {
  it("forwards uuid-shaped invited_by + invited_project_id", async () => {
    const r = await startStaffRegistration({
      fullName: "ช่าง ทดสอบ",
      phone: "0810000000",
      invitedBy: SA,
      invitedProjectId: PROJECT,
    });
    expect(r).toEqual({ ok: true, employeeId: "PRC-26-0009" });
    expect(rpc).toHaveBeenCalledWith("start_staff_registration", {
      p_full_name: "ช่าง ทดสอบ",
      p_phone: "0810000000",
      p_invited_by: SA,
      p_invited_project_id: PROJECT,
    });
  });

  it("drops a non-uuid invited_by / invited_project_id (never reaches the uuid arg)", async () => {
    await startStaffRegistration({
      fullName: "ช่าง",
      phone: "0810000000",
      invitedBy: "not-a-uuid",
      invitedProjectId: "also-bad",
    });
    expect(rpc).toHaveBeenCalledWith("start_staff_registration", {
      p_full_name: "ช่าง",
      p_phone: "0810000000",
    });
  });

  it("omits both when not provided (baseline unchanged)", async () => {
    await startStaffRegistration({ fullName: "ช่าง", phone: "0810000000" });
    expect(rpc).toHaveBeenCalledWith("start_staff_registration", {
      p_full_name: "ช่าง",
      p_phone: "0810000000",
    });
  });

  // Spec 328 — the per-firm QR adds ?contractor=<uuid> (advisory, same trust
  // model as ?project): uuid-gated at the action boundary, existence-coerced in
  // the DEFINER body.
  it("spec 328: forwards a uuid-shaped invitedContractorId", async () => {
    const FIRM = "55555555-5555-4555-8555-555555555555";
    await startStaffRegistration({
      fullName: "สมาชิก ทีมอวย",
      phone: "0810000328",
      invitedContractorId: FIRM,
    });
    expect(rpc).toHaveBeenCalledWith("start_staff_registration", {
      p_full_name: "สมาชิก ทีมอวย",
      p_phone: "0810000328",
      p_invited_contractor_id: FIRM,
    });
  });

  it("spec 328: drops a non-uuid invitedContractorId", async () => {
    await startStaffRegistration({
      fullName: "สมาชิก",
      phone: "0810000328",
      invitedContractorId: "forged-nonsense",
    });
    expect(rpc).toHaveBeenCalledWith("start_staff_registration", {
      p_full_name: "สมาชิก",
      p_phone: "0810000328",
    });
  });

  it("forwards declaredRoleHint alongside the invite refs", async () => {
    await startStaffRegistration({
      fullName: "ช่าง",
      phone: "0810000000",
      declaredRoleHint: "ช่างไฟ",
      invitedBy: SA,
    });
    expect(rpc).toHaveBeenCalledWith("start_staff_registration", {
      p_full_name: "ช่าง",
      p_phone: "0810000000",
      p_declared_role_hint: "ช่างไฟ",
      p_invited_by: SA,
    });
  });
});
