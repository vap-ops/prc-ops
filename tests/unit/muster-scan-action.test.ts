// Writing failing test first.
//
// Spec 351 U2 — musterScan gains a `session` ("regular" | "ot") input and threads
// it to the RPC as p_session; the OT-guard error (a worker doing OT without a
// regular session on this team) maps to its own Thai string. Gate + client mocked:
// pins the arg mapping + error map, not the DB.

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

import { musterScan } from "@/lib/muster/actions";

const TEAM = "11111111-1111-1111-1111-111111111111";
const WORKER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc } });
  rpc.mockReset().mockResolvedValue({ data: "att-1", error: null });
});

describe("musterScan — session passthrough", () => {
  it("threads session:'regular' to muster_scan_in as p_session", async () => {
    const r = await musterScan({
      teamId: TEAM,
      workerId: WORKER,
      mode: "in",
      method: "manual",
      session: "regular",
      revalidate: "/projects/x/muster",
    });
    expect(r).toEqual({ ok: true, id: "att-1" });
    expect(rpc).toHaveBeenCalledWith("muster_scan_in", {
      p_team: TEAM,
      p_worker: WORKER,
      p_method: "manual",
      p_session: "regular",
    });
  });

  it("threads session:'ot' to muster_scan_out for an OT check-out", async () => {
    await musterScan({
      teamId: TEAM,
      workerId: WORKER,
      mode: "out",
      method: "qr",
      session: "ot",
      revalidate: "/projects/x/muster",
    });
    expect(rpc).toHaveBeenCalledWith("muster_scan_out", {
      p_team: TEAM,
      p_worker: WORKER,
      p_method: "qr",
      p_session: "ot",
    });
  });

  it("maps the OT-guard error to its own Thai string", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_in: no regular session on this team today" },
    });
    const r = await musterScan({
      teamId: TEAM,
      workerId: WORKER,
      mode: "in",
      method: "manual",
      session: "ot",
      revalidate: "/projects/x/muster",
    });
    expect(r).toEqual({ ok: false, error: "ต้องเช็คชื่อเข้างานปกติในทีมนี้ก่อนทำ OT" });
  });

  it("still maps the pre-existing cross-team conflict verbatim substring", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_in: worker is already mustered elsewhere today" },
    });
    const r = await musterScan({
      teamId: TEAM,
      workerId: WORKER,
      mode: "in",
      method: "manual",
      session: "regular",
      revalidate: "/projects/x/muster",
    });
    expect(r).toEqual({ ok: false, error: "ช่างคนนี้อยู่ในทีมอื่นแล้ววันนี้" });
  });
});
