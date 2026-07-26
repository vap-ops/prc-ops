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

import { closeOpenOt, musterScan } from "@/lib/muster/actions";

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

// Writing failing test first.
//
// Spec 306 close-day cure (operator 2026-07-26): ปิดวัน never blocks — closing is
// recoverable (the scan RPCs carry no closure guard and a re-close re-derives),
// while NOT closing is not, which is the 07-24 failure. But an OT session left
// open at close is lost for good (`close_muster_day` auto-outs REGULAR only, and
// `muster_scan_out` prices the span from now(), so closing it tomorrow bills
// garbage). So the confirm offers the CURE — close every open OT at the current
// time — and this action is that cure. It must never report success on a partial
// close: the caller only closes the day when every OT actually closed.
describe("closeOpenOt — the close-day cure", () => {
  const T1 = "aaaaaaaa-0000-0000-0000-000000000001";
  const T2 = "aaaaaaaa-0000-0000-0000-000000000002";
  const W_1 = "bbbbbbbb-0000-0000-0000-000000000001";
  const W_2 = "bbbbbbbb-0000-0000-0000-000000000002";
  const REVAL = "/projects/x/muster";

  it("closes each open OT session against its OWN team, via muster_scan_out", async () => {
    const r = await closeOpenOt({
      sessions: [
        { teamId: T1, workerId: W_1 },
        { teamId: T2, workerId: W_2 },
      ],
      revalidate: REVAL,
    });
    expect(r).toEqual({ ok: true, closed: 2 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("muster_scan_out", {
      p_team: T1,
      p_worker: W_1,
      p_method: "manual",
      p_session: "ot",
    });
    expect(rpc).toHaveBeenCalledWith("muster_scan_out", {
      p_team: T2,
      p_worker: W_2,
      p_method: "manual",
      p_session: "ot",
    });
  });

  it("reports failure when ANY single OT refuses — a partial cure must not read as done", async () => {
    rpc
      .mockResolvedValueOnce({ data: "ok", error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "muster_scan_out: role not permitted" },
      });
    const r = await closeOpenOt({
      sessions: [
        { teamId: T1, workerId: W_1 },
        { teamId: T2, workerId: W_2 },
      ],
      revalidate: REVAL,
    });
    expect(r.ok).toBe(false);
  });

  it("is a no-op success with nothing to close", async () => {
    const r = await closeOpenOt({ sessions: [], revalidate: REVAL });
    expect(r).toEqual({ ok: true, closed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates every id before writing anything — one bad pair writes NOTHING", async () => {
    const r = await closeOpenOt({
      sessions: [
        { teamId: T1, workerId: W_1 },
        { teamId: "nope", workerId: W_2 },
      ],
      revalidate: REVAL,
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
