// Spec 397 U5 — opening the office team from the app.
//
// U4 made a leadless office team legal in the DATABASE; this action still refused
// it, because `openMusterTeam` UUID-validates `leadWorkerId` before it reaches the
// RPC. The crew arm must keep that requirement (the cockpit board groups by lead),
// so the validation becomes per-kind, exactly like the RPC's own guard.
//
// Gate + client mocked (the muster-undo-action.test.ts harness): this pins the
// argument mapping and the guard, not the database.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { openMusterTeam } from "@/lib/muster/actions";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const DATE = "2026-08-05";
const REVALIDATE = "/team/office";

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc } });
  rpc.mockReset().mockResolvedValue({ data: "team-id", error: null });
});

describe("spec 397 U5 — openMusterTeam and the office kind", () => {
  it("opens an office team with NO lead", async () => {
    const r = await openMusterTeam({
      projectId: PROJECT,
      date: DATE,
      leadWorkerId: null,
      kind: "office",
      revalidate: REVALIDATE,
    });
    expect(r).toEqual({ ok: true, id: "team-id" });
    expect(rpc).toHaveBeenCalledWith("open_muster_team", {
      p_project: PROJECT,
      p_date: DATE,
      p_lead_worker: null,
      p_kind: "office",
    });
  });

  it("still REFUSES a crew team with no lead, before reaching the database", async () => {
    const r = await openMusterTeam({
      projectId: PROJECT,
      date: DATE,
      leadWorkerId: null,
      kind: "crew",
      revalidate: REVALIDATE,
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("defaults to crew when no kind is given — every existing caller is unchanged", async () => {
    await openMusterTeam({
      projectId: PROJECT,
      date: DATE,
      leadWorkerId: LEAD,
      revalidate: REVALIDATE,
    });
    expect(rpc).toHaveBeenCalledWith(
      "open_muster_team",
      expect.objectContaining({ p_lead_worker: LEAD, p_kind: "crew" }),
    );
  });

  it("validates a NON-null lead even for an office team", async () => {
    const r = await openMusterTeam({
      projectId: PROJECT,
      date: DATE,
      leadWorkerId: "not-a-uuid",
      kind: "office",
      revalidate: REVALIDATE,
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
