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
    rpc.mockResolvedValueOnce({ data: "ok", error: null }).mockResolvedValueOnce({
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

// Writing failing test first.
//
// Spec 306 §5 — muster_scan_out refuses an already-out worker instead of
// overwriting their real departure. The refusal must reach the SA as its own
// sentence: "nothing happened" is indistinguishable from a dead button, and the
// GENERIC fallback ("กรุณาลองใหม่อีกครั้ง") would be an honest-copy violation —
// it invites a retry that can never succeed.
//
// The mapping is exercised through the REAL action with only the DB mocked, so
// this pins the copy where it actually lives (a test that mocked the action
// itself would pin nothing).
describe("musterScan — the already-out refusal (spec 306 §5)", () => {
  const args = {
    teamId: TEAM,
    workerId: WORKER,
    mode: "out",
    method: "qr",
    session: "regular",
    revalidate: "/projects/x/muster",
  } as const;

  it("carries the departure time the RPC reported", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: already checked out at 17:02" },
    });
    const r = await musterScan({ ...args });
    expect(r).toEqual({
      ok: false,
      error: "ช่างคนนี้ออกงานแล้วเมื่อ 17:02 น.",
      reason: "already_out",
    });
  });

  it("still answers honestly if the message ever loses its time", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: already checked out at" },
    });
    const r = await musterScan({ ...args });
    expect(r).toEqual({ ok: false, error: "ช่างคนนี้ออกงานแล้ว", reason: "already_out" });
  });

  it("never degrades to the generic retry copy", async () => {
    // The specific failure this guards: a reworded RPC message falling through
    // to GENERIC, which tells the SA to try again at the one thing that is now
    // permanently refused.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: already checked out at 08:15" },
    });
    const r = await musterScan({ ...args });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("ลองใหม่");
  });

  // CONTRASTING CONTROL — the arm sits above `no attendance`, which answers the
  // OPPOSITE claim (never checked in). Ordered substring matching means a new
  // arm can silently swallow a later one; this proves it did not.
  it("does not swallow the never-checked-in refusal below it", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: no attendance for this worker on the team's date" },
    });
    const r = await musterScan({ ...args });
    expect(r).toEqual({ ok: false, error: "ยังไม่ได้เช็คชื่อเข้าของช่างคนนี้" });
  });
});

// Writing failing test first.
//
// Spec 400 U4 — muster_scan_out now REFUSES a session whose day is over.
//
// Why the copy matters here specifically: the refusal is PERMANENT for this
// caller. Before U4 the RPC had no date check at all, so a site_admin could
// close 2026-07-24's nine still-open OT sessions today — stamping out_at = now()
// and pricing ot_hours at ~13 days. The hole was "permitted and wrong", not
// "blocked", so the guard has to exist AND has to explain itself: falling
// through to GENERIC ("กรุณาลองใหม่อีกครั้ง") would invite a retry that can never
// succeed, which is the honest-copy class this repo has now paid for five times.
//
// The copy names the FACT and no actor. Its readers are muster_scan_out's whole
// gate — {site_admin, super_admin, procurement_manager} — and only the last two
// are in the correction audience, so an instruction ("ask X", "go to Y") would
// be true for some of them and false for the rest. It also must not name
// /team/attendance: site_admin is not in ATTENDANCE_AUDIT_ROLES and cannot open
// it. Same reasoning muster_undo_scan's `already closed` arm carries.
describe("musterScan — the day-is-over refusal (spec 400 U4)", () => {
  const args = {
    teamId: TEAM,
    workerId: WORKER,
    mode: "out",
    method: "qr",
    session: "ot",
    revalidate: "/projects/x/muster",
  } as const;

  it("says the window has closed, not that the tap failed", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: this session belongs to an earlier day" },
    });
    const r = await musterScan({ ...args });
    expect(r).toEqual({
      ok: false,
      error: "หมดเวลาบันทึกออกงานของวันนั้นแล้ว — ต้องแก้เวลาย้อนหลัง",
    });
  });

  it("never degrades to the generic retry copy", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: this session belongs to an earlier day" },
    });
    const r = await musterScan({ ...args });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("ลองใหม่");
  });

  // CONTRASTING CONTROL — this arm must not swallow `already checked out`, which
  // is a DIFFERENT refusal with a different remedy (and its own `reason` field
  // that two components branch on). Ordered substring matching is why.
  it("leaves the already-out refusal and its reason intact", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: already checked out at 17:02" },
    });
    const r = await musterScan({ ...args });
    expect(r).toEqual({
      ok: false,
      error: "ช่างคนนี้ออกงานแล้วเมื่อ 17:02 น.",
      reason: "already_out",
    });
  });
});

// Writing failing test first.
//
// Spec 306 §5 — the two BENIGN-REFUSAL consequences of the new server guard.
// Both are regressions the guard itself introduced: a call that used to succeed
// silently now returns an error, and two callers were reading every error as a
// failure.
const T_A = "aaaaaaaa-0000-0000-0000-0000000000a1";
const T_B = "aaaaaaaa-0000-0000-0000-0000000000b1";
const W_A = "bbbbbbbb-0000-0000-0000-0000000000a1";
const W_B = "bbbbbbbb-0000-0000-0000-0000000000b1";

describe("the already-out refusal is routed as benign, not as a failure", () => {
  const args = {
    teamId: TEAM,
    workerId: WORKER,
    mode: "out",
    method: "qr",
    session: "regular",
    revalidate: "/projects/x/muster",
  } as const;

  it("musterScan flags it with reason:'already_out' at the raw-message seam", async () => {
    // The flag is set where the SQLSTATE message still exists, so no component
    // has to match Thai copy to recognise it.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: already checked out at 17:02" },
    });
    const r = await musterScan({ ...args });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already_out");
  });

  it("and does NOT flag an ordinary refusal", async () => {
    // Contrasting control: without this, `reason` could be set unconditionally
    // and every failure would render as benign — the inverse bug, and a worse
    // one, since a real refusal would then be silent.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: role not permitted" },
    });
    const r = await musterScan({ ...args });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBeUndefined();
  });

  it("closeOpenOt counts an already-closed session as cured, not as a failure", async () => {
    // The cure's postcondition is "no OT is left open", and a session someone
    // else already closed satisfies it. Before the guard this call succeeded
    // silently; treating the refusal as an error would make the retry after a
    // PARTIAL cure fail on the sessions that already worked — and ปิดวัน is the
    // action the 07-24 incident exists to protect.
    rpc.mockResolvedValueOnce({ data: "ok", error: null }).mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: already checked out at 19:40" },
    });
    const r = await closeOpenOt({
      sessions: [
        { teamId: T_A, workerId: W_A },
        { teamId: T_B, workerId: W_B },
      ],
      revalidate: "/projects/x/muster",
    });
    // ok — but `closed` reports what THIS call actually did, so a caller
    // comparing it against the list it sent can still see the difference.
    expect(r).toEqual({ ok: true, closed: 1 });
  });

  it("but a genuine refusal mid-cure still fails the whole cure", async () => {
    rpc.mockResolvedValueOnce({ data: "ok", error: null }).mockResolvedValueOnce({
      data: null,
      error: { message: "muster_scan_out: role not permitted" },
    });
    const r = await closeOpenOt({
      sessions: [
        { teamId: T_A, workerId: W_A },
        { teamId: T_B, workerId: W_B },
      ],
      revalidate: "/projects/x/muster",
    });
    expect(r.ok).toBe(false);
  });
});
