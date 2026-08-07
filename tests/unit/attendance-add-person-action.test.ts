// Writing failing test first.
//
// Spec 400 U3c-b — `addMusterPerson` relays to `muster_correct_session`'s INSERT
// path and maps ITS refusals to outcome CODES.
//
// A code, never a sentence: the outcome travels back in the URL, where a Thai
// message is unbounded, survives in history and screenshots, and would let a
// crafted link render attacker-chosen text inside the app's own error notice. The
// page owns the copy — including the honest-copy rule, because not one arm here
// is retryable in a way "ลองใหม่" could promise.
//
// Gate + client mocked: this pins the ARG MAPPING and the ERROR MAP, not the DB.
// The RPC's own gates are driven behaviourally in
// supabase/tests/database/400b-muster-correct-session.test.sql.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, rpc } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({ requireActionRole }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("server-only", () => ({}));

import { addMusterPerson } from "@/app/team/attendance/actions";

const TEAM = "aaaaaaaa-1111-1111-1111-111111111111";
const WORKER = "bbbbbbbb-2222-2222-2222-222222222222";

function args(over: Partial<Parameters<typeof addMusterPerson>[0]> = {}) {
  return { teamId: TEAM, workerId: WORKER, workDate: "2026-08-04", inTime: "08:15", ...over };
}

function refusal(message: string, code = "P0001") {
  rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActionRole.mockResolvedValue({ auth: { supabase: { rpc } } });
  rpc.mockResolvedValue({ data: TEAM, error: null });
});

describe("addMusterPerson — the arguments it sends", () => {
  // toHaveBeenCalledWith is an EXACT match, so this also pins the absence of
  // p_out_at: the parameter is optional in the RPC, its generated type is
  // `p_out_at?: string`, and exactOptionalPropertyTypes rejects an explicit
  // undefined — so omitting it is both the only legal spelling and the correct
  // instruction (this records an arrival; a departure is its own correction).
  it("sends the SUPPLIED time as in_at with the Bangkok offset, and no out_at", async () => {
    const r = await addMusterPerson(args());
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("muster_correct_session", {
      p_team: TEAM,
      p_worker: WORKER,
      p_session: "regular",
      p_in_at: "2026-08-04T08:15:00+07:00",
    });
    const sent = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("p_out_at" in sent).toBe(false);
  });

  // The whole reason U4 exists. If this ever sends null, the column default
  // (now()) stamps the correction moment and close_muster_day's auto-out —
  // greatest(17:00, in_at) — turns it into a ZERO-LENGTH session.
  it("never sends a null in_at", async () => {
    await addMusterPerson(args());
    const sent = rpc.mock.calls[0]?.[1] as { p_in_at: unknown };
    expect(sent.p_in_at).not.toBeNull();
  });

  // `regular` is hard-coded, not passed through: an OT session is ×1.5 money
  // (spec 351) and the RPC refuses to CREATE one — a form field here would be an
  // offer the server declines.
  it("always asks for a regular session", async () => {
    await addMusterPerson(args());
    const sent = rpc.mock.calls[0]?.[1] as { p_session: unknown };
    expect(sent.p_session).toBe("regular");
  });
});

describe("addMusterPerson — refusals", () => {
  it("refuses a malformed id, date or time WITHOUT calling the RPC", async () => {
    for (const bad of [
      args({ teamId: "not-a-uuid" }),
      args({ workerId: "not-a-uuid" }),
      args({ workDate: "04/08/2026" }),
      args({ inTime: "25:00" }),
      args({ inTime: "" }),
    ]) {
      const r = await addMusterPerson(bad);
      expect(r).toEqual({ ok: false, outcome: "shape" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the role/scope refusal to denied", async () => {
    refusal("muster_correct_session: role not permitted", "42501");
    expect(await addMusterPerson(args())).toEqual({ ok: false, outcome: "denied" });
  });

  it("maps a closed day to its own code, because the reader can reopen it", async () => {
    refusal("muster_correct_session: a missing person may only be added to an open day");
    expect(await addMusterPerson(args())).toEqual({ ok: false, outcome: "closed" });
  });

  // muster_correct_session delegates the insert to muster_scan_in, so the
  // duplicate refusals are ITS wording — three different sentences, one outcome.
  it("maps every already-mustered wording to duplicate", async () => {
    for (const message of [
      "muster_scan_in: worker already in team of สมชาย today",
      "muster_scan_in: worker is already mustered elsewhere today",
      "muster_scan_in: worker is already in the office team today",
    ]) {
      refusal(message);
      expect(await addMusterPerson(args())).toEqual({ ok: false, outcome: "duplicate" });
    }
  });

  it("maps a vanished team to noteam", async () => {
    refusal("muster_correct_session: team not found");
    expect(await addMusterPerson(args())).toEqual({ ok: false, outcome: "noteam" });
  });

  it("falls back to failed for anything unrecognised", async () => {
    refusal("muster_correct_session: something nobody has seen");
    expect(await addMusterPerson(args())).toEqual({ ok: false, outcome: "failed" });
  });

  it("refuses when the gate does, without calling the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "denied" });
    expect(await addMusterPerson(args())).toEqual({ ok: false, outcome: "denied" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
