// Writing failing test first.
//
// Spec 264 follow-up (site assignment at approval) — the approve action forwards
// the approver's OPTIONAL project selection as p_project_id to
// approve_staff_registration. The RPC already supports this parameter (G1); the
// UI simply never surfaced it before now, so it was always effectively null.
// This pins: (1) a selected project id is forwarded verbatim, (2) an
// unselected/absent/blank project OMITS the key entirely (the generated RPC arg
// type is `p_project_id?: string`, so exactOptionalPropertyTypes forbids `null`
// literally; SQL's `default null` makes an omitted param behaviorally identical
// to an explicit null). Role/session gate + the rpc call are mocked — this pins
// the wiring, not the DB.

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
const PROJECT = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: { supabase: { rpc }, user: { id: "approver-1" } },
    role: "procurement_manager",
  });
  rpc.mockReset().mockResolvedValue({ data: "worker-1", error: null });
});

describe("approveStaffRegistration — site assignment at approval", () => {
  it("forwards the selected project id as p_project_id", async () => {
    const r = await approveStaffRegistration({
      registrationId: REG,
      role: "technician",
      projectId: PROJECT,
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "technician",
      p_project_id: PROJECT,
    });
  });

  it("omits p_project_id when no project is selected (null)", async () => {
    const r = await approveStaffRegistration({
      registrationId: REG,
      role: "technician",
      projectId: null,
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "technician",
    });
  });

  it("omits p_project_id when projectId is omitted entirely", async () => {
    const r = await approveStaffRegistration({ registrationId: REG, role: "technician" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "technician",
    });
  });

  it("omits p_project_id when an empty-string projectId is passed (the selector's empty option)", async () => {
    const r = await approveStaffRegistration({
      registrationId: REG,
      role: "technician",
      projectId: "",
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("approve_staff_registration", {
      p_id: REG,
      p_role: "technician",
    });
  });
});
