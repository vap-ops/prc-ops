// Writing failing test first.
//
// Spec 400 U6a — the fix page's own two write actions: retiming an EXISTING
// session (`muster_correct_session`'s UPDATE path) and deleting one
// (`muster_undo_scan`). Both relay to their RPC and map ITS refusals to outcome
// CODES, exactly like reopenMusterDay/closeMusterDay/addMusterPerson beside
// them — a code, never a sentence, because the outcome travels back in the URL
// and the page owns the copy.
//
// Gate + client mocked: this pins the ARG MAPPING and the ERROR MAP, not the
// DB. The RPC's own gates are driven behaviourally in
// supabase/tests/database/400b-muster-correct-session.test.sql and
// 379-* / 397-* for muster_undo_scan.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { retimeReturnTo, undoReturnTo } from "@/lib/muster/reopen-return";

const { requireActionRole, rpc } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({ requireActionRole }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("server-only", () => ({}));

import { correctMusterSession, undoAttendanceSession } from "@/app/team/attendance/fix/actions";

const TEAM = "aaaaaaaa-1111-1111-1111-111111111111";
const WORKER = "bbbbbbbb-2222-2222-2222-222222222222";

function retimeArgs(over: Partial<Parameters<typeof correctMusterSession>[0]> = {}) {
  return {
    teamId: TEAM,
    workerId: WORKER,
    session: "regular" as const,
    workDate: "2026-08-04",
    inTime: "08:15",
    outTime: "",
    currentInTime: "",
    ...over,
  };
}

function undoArgs(over: Partial<Parameters<typeof undoAttendanceSession>[0]> = {}) {
  return { workerId: WORKER, workDate: "2026-08-04", session: "regular" as const, ...over };
}

function refusal(message: string, code = "P0001") {
  rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActionRole.mockResolvedValue({ auth: { supabase: { rpc } } });
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("retimeReturnTo / undoReturnTo — the redirect target", () => {
  it("appends the success code before any fragment", () => {
    expect(retimeReturnTo("/team/attendance/fix?worker=x#top", "ok")).toBe(
      "/team/attendance/fix?worker=x&retimed=1#top",
    );
    expect(undoReturnTo("/team/attendance/fix?worker=x#top", "ok")).toBe(
      "/team/attendance/fix?worker=x&undone=1#top",
    );
  });

  it("appends the error code, not the message", () => {
    expect(retimeReturnTo("/team/attendance/fix", "booked")).toBe(
      "/team/attendance/fix?retimeError=booked",
    );
    expect(undoReturnTo("/team/attendance/fix", "closed")).toBe(
      "/team/attendance/fix?undoError=closed",
    );
  });

  it("falls back off an unsafe or missing referrer, same as every other muster form", () => {
    expect(retimeReturnTo(undefined, "ok")).toBe("/team/attendance?retimed=1");
    expect(retimeReturnTo("//evil.com", "ok")).toBe("/team/attendance?retimed=1");
  });
});

describe("correctMusterSession — the arguments it sends", () => {
  it("omits BOTH optional times when both fields are blank — never sends a null", async () => {
    const r = await correctMusterSession(retimeArgs({ inTime: "", outTime: "" }));
    expect(r).toEqual({ ok: false, outcome: "shape" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends only p_in_at when only the in field is filled", async () => {
    await correctMusterSession(retimeArgs({ inTime: "08:15", outTime: "" }));
    expect(rpc).toHaveBeenCalledWith("muster_correct_session", {
      p_team: TEAM,
      p_worker: WORKER,
      p_session: "regular",
      p_in_at: "2026-08-04T08:15:00+07:00",
    });
    const sent = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("p_out_at" in sent).toBe(false);
  });

  it("sends only p_out_at when only the out field is filled", async () => {
    await correctMusterSession(retimeArgs({ inTime: "", outTime: "17:30" }));
    const sent = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("p_in_at" in sent).toBe(false);
    expect(sent.p_out_at).toBe("2026-08-04T17:30:00+07:00");
  });

  it("sends both when both are filled", async () => {
    await correctMusterSession(retimeArgs({ inTime: "08:15", outTime: "17:30" }));
    expect(rpc).toHaveBeenCalledWith("muster_correct_session", {
      p_team: TEAM,
      p_worker: WORKER,
      p_session: "regular",
      p_in_at: "2026-08-04T08:15:00+07:00",
      p_out_at: "2026-08-04T17:30:00+07:00",
    });
  });

  it("passes the session through unchanged (regular or ot)", async () => {
    await correctMusterSession(retimeArgs({ session: "ot", inTime: "20:00" }));
    const sent = rpc.mock.calls[0]?.[1] as { p_session: unknown };
    expect(sent.p_session).toBe("ot");
  });
});

// Fresh-eyes finding, HIGH (2026-08-07). `muster_correct_session` deliberately
// permits `p_out_at` up to `((work_date + 1) + time '06:00')` — migration
// 20260813075915's ruling 3, so a night OT crossing midnight stays recordable,
// and the codebase already models the case (`AttendanceDetailRow.outNextDay`).
// Pinning the OUT stamp to the work date made that capability UNREACHABLE from
// this screen: an out of 01:30 became `<workDate>T01:30+07:00`, i.e. BEFORE the
// check-in, so the RPC answered "check-out cannot precede check-in" and the
// corrector was blamed for the app's own construction. The nine 2026-07-24 OT
// rows are exactly the population this page exists to repair.
describe("correctMusterSession — an overnight check-out rolls to the next day", () => {
  it("keeps a same-day out on the work date", async () => {
    await correctMusterSession(
      retimeArgs({ inTime: "", outTime: "17:30", currentInTime: "08:15" }),
    );
    const sent = rpc.mock.calls[0]?.[1] as { p_out_at: string };
    expect(sent.p_out_at).toBe("2026-08-04T17:30:00+07:00");
  });

  it("rolls an out EARLIER than the check-in onto the following date", async () => {
    // 20:00 in, 01:30 out — the only reading that is not an inverted session.
    await correctMusterSession(
      retimeArgs({ inTime: "", outTime: "01:30", currentInTime: "20:00" }),
    );
    const sent = rpc.mock.calls[0]?.[1] as { p_out_at: string };
    expect(sent.p_out_at).toBe("2026-08-05T01:30:00+07:00");
  });

  it("compares against the NEW in-time when the same submit moves both", async () => {
    // The roll must key on the effective pair, not on the stored in-time — the
    // same "validate the EFFECTIVE PAIR after coalescing" rule U4 shipped.
    await correctMusterSession(
      retimeArgs({ inTime: "21:00", outTime: "02:00", currentInTime: "08:00" }),
    );
    const sent = rpc.mock.calls[0]?.[1] as { p_in_at: string; p_out_at: string };
    expect(sent.p_in_at).toBe("2026-08-04T21:00:00+07:00");
    expect(sent.p_out_at).toBe("2026-08-05T02:00:00+07:00");
  });

  it("does NOT roll when there is no in-time to compare against", async () => {
    // No stored in-time and none supplied: rolling would be a guess. Same date,
    // and the RPC's own bounds answer whatever is wrong with it.
    await correctMusterSession(retimeArgs({ inTime: "", outTime: "01:30", currentInTime: "" }));
    const sent = rpc.mock.calls[0]?.[1] as { p_out_at: string };
    expect(sent.p_out_at).toBe("2026-08-04T01:30:00+07:00");
  });
});

describe("correctMusterSession — refusals", () => {
  it("refuses a malformed id, date or session WITHOUT calling the RPC", async () => {
    for (const bad of [
      retimeArgs({ teamId: "not-a-uuid" }),
      retimeArgs({ workerId: "not-a-uuid" }),
      retimeArgs({ workDate: "04/08/2026" }),
      // @ts-expect-error — exercising a hand-posted, malformed value
      retimeArgs({ session: "nights" }),
    ]) {
      const r = await correctMusterSession(bad);
      expect(r).toEqual({ ok: false, outcome: "shape" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed time WITHOUT calling the RPC", async () => {
    const r = await correctMusterSession(retimeArgs({ inTime: "25:99", outTime: "" }));
    expect(r).toEqual({ ok: false, outcome: "shape" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the role/scope refusal to denied", async () => {
    refusal("muster_correct_session: role not permitted", "42501");
    expect(await correctMusterSession(retimeArgs())).toEqual({ ok: false, outcome: "denied" });
  });

  it("maps every time-bound refusal to bounds", async () => {
    for (const message of [
      "muster_correct_session: check-in time must fall on the work date",
      "muster_correct_session: a time cannot be in the future",
      "muster_correct_session: check-out is too late for this work date",
      "muster_correct_session: check-out cannot precede check-in",
    ]) {
      refusal(message);
      expect(await correctMusterSession(retimeArgs())).toEqual({ ok: false, outcome: "bounds" });
    }
  });

  it("maps a recorded (non-auto) check-out refusal to locked", async () => {
    refusal("muster_correct_session: a recorded check-out cannot be replaced");
    expect(await correctMusterSession(retimeArgs())).toEqual({ ok: false, outcome: "locked" });
  });

  it("maps a booked wage to booked", async () => {
    refusal("muster_correct_session: wages are already booked for this check-in");
    expect(await correctMusterSession(retimeArgs())).toEqual({ ok: false, outcome: "booked" });
  });

  it("maps a stale team mismatch to stale — reload, don't retry blindly", async () => {
    refusal("muster_correct_session: worker is in another team today — move first");
    expect(await correctMusterSession(retimeArgs())).toEqual({ ok: false, outcome: "stale" });
  });

  it("falls back to failed for anything unrecognised", async () => {
    refusal("muster_correct_session: something nobody has seen");
    expect(await correctMusterSession(retimeArgs())).toEqual({ ok: false, outcome: "failed" });
  });

  it("refuses when the gate does, without calling the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "denied" });
    expect(await correctMusterSession(retimeArgs())).toEqual({ ok: false, outcome: "denied" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("undoAttendanceSession — the arguments it sends", () => {
  it("sends worker, date and session — no team id (the RPC's own unique key)", async () => {
    await undoAttendanceSession(undoArgs());
    expect(rpc).toHaveBeenCalledWith("muster_undo_scan", {
      p_worker: WORKER,
      p_date: "2026-08-04",
      p_session: "regular",
    });
  });
});

describe("undoAttendanceSession — refusals", () => {
  it("refuses a malformed id, date or session WITHOUT calling the RPC", async () => {
    for (const bad of [
      undoArgs({ workerId: "not-a-uuid" }),
      undoArgs({ workDate: "04/08/2026" }),
      // @ts-expect-error — exercising a hand-posted, malformed value
      undoArgs({ session: "nights" }),
    ]) {
      const r = await undoAttendanceSession(bad);
      expect(r).toEqual({ ok: false, outcome: "shape" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the role/scope refusal to denied", async () => {
    refusal("muster_undo_scan: role not permitted", "42501");
    expect(await undoAttendanceSession(undoArgs())).toEqual({ ok: false, outcome: "denied" });
  });

  it("maps an already-gone row to gone", async () => {
    refusal("muster_undo_scan: no check-in to undo");
    expect(await undoAttendanceSession(undoArgs())).toEqual({ ok: false, outcome: "gone" });
  });

  it("maps a closed day to closed", async () => {
    refusal("muster_undo_scan: the day is already closed");
    expect(await undoAttendanceSession(undoArgs())).toEqual({ ok: false, outcome: "closed" });
  });

  it("maps a booked wage to booked", async () => {
    refusal("muster_undo_scan: wages are already booked for this check-in");
    expect(await undoAttendanceSession(undoArgs())).toEqual({ ok: false, outcome: "booked" });
  });

  it("maps a surviving OT session to otFirst", async () => {
    refusal("muster_undo_scan: undo the OT session first");
    expect(await undoAttendanceSession(undoArgs())).toEqual({ ok: false, outcome: "otFirst" });
  });

  it("falls back to failed for anything unrecognised", async () => {
    refusal("muster_undo_scan: something nobody has seen");
    expect(await undoAttendanceSession(undoArgs())).toEqual({ ok: false, outcome: "failed" });
  });

  it("refuses when the gate does, without calling the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "denied" });
    expect(await undoAttendanceSession(undoArgs())).toEqual({ ok: false, outcome: "denied" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
