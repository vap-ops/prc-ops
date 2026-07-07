// Writing failing test first.
//
// Spec 272 — the two new roster actions relay to the spec-161 SECURITY DEFINER
// RPCs (which gate themselves: set_worker_level = super_admin; assign_project_ht
// = pm/pd/super + daily+active worker). The actions only validate shape.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { assignProjectHt, setWorkerLevel } from "@/app/workers/actions";

const WORKER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("setWorkerLevel (spec 272 U1)", () => {
  it("rejects a bad worker id before any RPC", async () => {
    const r = await setWorkerLevel({ id: "not-a-uuid", level: "senior" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a value outside the worker_level enum before any RPC", async () => {
    const r = await setWorkerLevel({ id: WORKER, level: "boss" as never });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("relays to set_worker_level with the exact arg shape", async () => {
    const r = await setWorkerLevel({ id: WORKER, level: "apprentice" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_worker_level", {
      p_worker: WORKER,
      p_level: "apprentice",
    });
  });

  it("maps an RPC error to the generic Thai error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "42501" } });
    const r = await setWorkerLevel({ id: WORKER, level: "mid" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ไม่สำเร็จ/);
  });
});

describe("assignProjectHt (spec 272 U2)", () => {
  it("rejects bad ids before any RPC", async () => {
    expect((await assignProjectHt({ projectId: "x", workerId: WORKER })).ok).toBe(false);
    expect((await assignProjectHt({ projectId: PROJECT, workerId: "" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("relays to assign_project_ht with the exact arg shape", async () => {
    const r = await assignProjectHt({ projectId: PROJECT, workerId: WORKER });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("assign_project_ht", {
      p_project: PROJECT,
      p_worker: WORKER,
    });
  });

  it("maps an RPC error to the generic Thai error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "P0001" } });
    const r = await assignProjectHt({ projectId: PROJECT, workerId: WORKER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ไม่สำเร็จ/);
  });
});
