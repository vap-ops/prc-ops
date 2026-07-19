// Writing failing test first.
//
// Spec 306 (U3 deferred item, built 2026-07-19) — moveMusterWorker server
// action over the LIVE move_muster_worker RPC (mig 075750): moves a worker's
// attendance row to another team on the SAME date + project (the RPC owns the
// guards: SA/super role, can_see_project, same-date team, same-project,
// attendance-exists; audits crew_change/muster_move). This pins the wiring +
// the Thai error arms only.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { moveMusterWorker } from "@/lib/muster/actions";

const WORKER = "aaaaaaaa-1111-4111-8111-111111111111";
const TEAM = "dddddddd-4444-4444-8444-444444444444";

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc }, user: { id: "sa-1" } });
  rpc.mockReset().mockResolvedValue({ data: "att-1", error: null });
});

describe("moveMusterWorker (spec 306 move UI)", () => {
  it("forwards worker + date + target team to move_muster_worker", async () => {
    const r = await moveMusterWorker({
      workerId: WORKER,
      date: "2026-07-19",
      toTeamId: TEAM,
      revalidate: "/projects/x/muster",
    });
    expect(r).toEqual({ ok: true, id: "att-1" });
    expect(rpc).toHaveBeenCalledWith("move_muster_worker", {
      p_worker: WORKER,
      p_date: "2026-07-19",
      p_to_team: TEAM,
    });
  });

  it("rejects malformed input before calling the RPC", async () => {
    const bad = await moveMusterWorker({
      workerId: "nope",
      date: "2026-07-19",
      toTeamId: TEAM,
      revalidate: "/projects/x/muster",
    });
    expect(bad.ok).toBe(false);
    const badDate = await moveMusterWorker({
      workerId: WORKER,
      date: "19/07/2026",
      toTeamId: TEAM,
      revalidate: "/projects/x/muster",
    });
    expect(badDate.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the RPC's move guards to Thai", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "move_muster_worker: cannot move across projects" },
    });
    const r = await moveMusterWorker({
      workerId: WORKER,
      date: "2026-07-19",
      toTeamId: TEAM,
      revalidate: "/projects/x/muster",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ย้ายข้ามโครงการไม่ได้");
  });

  it("maps target-team-not-for-this-date to Thai", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "move_muster_worker: target team is not for this date" },
    });
    const r = await moveMusterWorker({
      workerId: WORKER,
      date: "2026-07-19",
      toTeamId: TEAM,
      revalidate: "/projects/x/muster",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ทีมปลายทางไม่ใช่ของวันนี้");
  });
});
