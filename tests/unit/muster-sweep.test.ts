// Writing failing test first.
//
// Spec 359 U1 — the continuous-sweep reducer. Pure functions only: outcome
// classification from board state, the per-badge cooldown, and the tally fold.
// The camera loop itself stays untestable in jsdom, which is exactly why every
// decision it drives lives here instead.

import { describe, expect, it } from "vitest";
import {
  EMPTY_SWEEP,
  SCAN_COOLDOWN_MS,
  classifyScan,
  isCoolingDown,
  markFailed,
  markMoved,
  recordScan,
  type SweepAction,
  type SweepContext,
} from "@/lib/muster/sweep";

const TEAM = "team-nan";
const OTHER = "team-chan";
const LEAD_A = "lead-a";
const LEAD_B = "lead-b";

function ctx(over: Partial<SweepContext> = {}): SweepContext {
  return {
    teamId: TEAM,
    leadWorkerId: LEAD_A,
    workersById: new Map([
      ["w1", "จรูญ โสภา"],
      ["w2", "มิตร ฮามศรีพรม"],
      ["w3", "ปาณิศา บุญเรือง"],
    ]),
    todayTeamByWorker: new Map(),
    teamLeadById: new Map([
      [TEAM, "อนันต์ แสงทอง"],
      [OTHER, "จันทร์ เงางาม"],
    ]),
    priorLeadByWorker: new Map(),
    addedThisSweep: new Set<string>(),
    // Spec 359 U4 — every mustered worker's session state today, across ALL teams:
    // the resolved directions look the team up instead of being handed one.
    sessionByWorker: new Map(),
    ...over,
  };
}

/** The morning line — the one direction that CREATES membership. */
const MORNING: SweepAction = { session: "regular", direction: "in" };

describe("classifyScan", () => {
  it("adds a worker with no prior muster as first-time", () => {
    const c = classifyScan(ctx(), "w1", MORNING);
    expect(c.kind).toBe("added_first_time");
    expect(c.name).toBe("จรูญ โสภา");
    expect(c.shouldWrite).toBe(true);
  });

  it("adds a worker whose last muster was this same lead, with no warning", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_A, name: "อนันต์ แสงทอง" }]]) }),
      "w1",
      MORNING,
    );
    expect(c.kind).toBe("added");
    expect(c.detail).toBeNull();
    expect(c.shouldWrite).toBe(true);
  });

  it("warns when the worker's last muster was a different lead", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_B, name: "จันทร์ เงางาม" }]]) }),
      "w1",
      MORNING,
    );
    expect(c.kind).toBe("added_team_changed");
    expect(c.detail).toBe("จันทร์ เงางาม");
    expect(c.shouldWrite).toBe(true);
  });

  it("compares leads by ID, not display name — two leads may share a name", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_B, name: "อนันต์ แสงทอง" }]]) }),
      "w1",
      MORNING,
    );
    expect(c.kind).toBe("added_team_changed");
  });

  it("reports a worker already on THIS team without writing", () => {
    const c = classifyScan(ctx({ todayTeamByWorker: new Map([["w1", TEAM]]) }), "w1", MORNING);
    expect(c.kind).toBe("already_here");
    expect(c.shouldWrite).toBe(false);
  });

  it("counts a worker added earlier in this same sweep as already here", () => {
    const c = classifyScan(ctx({ addedThisSweep: new Set(["w1"]) }), "w1", MORNING);
    expect(c.kind).toBe("already_here");
    expect(c.shouldWrite).toBe(false);
  });

  it("names the other team when the worker is mustered elsewhere today", () => {
    const c = classifyScan(ctx({ todayTeamByWorker: new Map([["w1", OTHER]]) }), "w1", MORNING);
    expect(c.kind).toBe("other_team");
    expect(c.detail).toBe("จันทร์ เงางาม");
    expect(c.shouldWrite).toBe(false);
  });

  it("rejects a payload that is not a known worker", () => {
    const c = classifyScan(ctx(), "not-a-worker", MORNING);
    expect(c.kind).toBe("unknown_badge");
    expect(c.shouldWrite).toBe(false);
  });
});

// Writing failing test first.
//
// Spec 359 U4 — the sweep covers all four muster events, and the three that do
// NOT create membership resolve the team from the board instead of asking the SA
// to pick one (operator 2026-07-26: "all checking should [be QR]" + "checking out
// require no team picking"). The refusals are the safety, not politeness:
// `muster_scan_out` has no already-out guard — it sets `out_at = now()`
// unconditionally, so an unguarded re-scan rewrites a real 17:13 to 21:00 — and an
// OT check-out both prices labour (`ot_hours`) and cannot be reopened.
describe("classifyScan — resolved directions (spec 359 U4)", () => {
  const OUT: SweepAction = { session: "regular", direction: "out" };
  const OT_IN: SweepAction = { session: "ot", direction: "in" };
  const OT_OUT: SweepAction = { session: "ot", direction: "out" };

  /** w1 is mustered on the OTHER team today, regular session still open. */
  const onOther = (
    over: Partial<{
      outAt: string | null;
      ot: { inAt: string | null; outAt: string | null } | null;
    }> = {},
  ) =>
    ctx({
      teamId: null,
      todayTeamByWorker: new Map([["w1", OTHER]]),
      sessionByWorker: new Map([["w1", { teamId: OTHER, outAt: null, ot: null, ...over }]]),
    });

  it("checks a mustered worker out of the team the BOARD says they are on, with no team picked", () => {
    const c = classifyScan(onOther(), "w1", OUT);
    expect(c.kind).toBe("checked_out");
    expect(c.shouldWrite).toBe(true);
    // The write must name their own team — there is no active team to fall back on.
    expect(c.teamId).toBe(OTHER);
    // …and the tally names it, so a team-agnostic sweep stays auditable.
    expect(c.detail).toBe("จันทร์ เงางาม");
  });

  it("never rewrites a check-out that already happened", () => {
    const c = classifyScan(onOther({ outAt: "2026-07-26T10:13:00Z" }), "w1", OUT);
    expect(c.kind).toBe("already_out");
    expect(c.shouldWrite).toBe(false);
  });

  it("refuses a badge with no session on this project's board today", () => {
    const c = classifyScan(ctx({ teamId: null }), "w1", OUT);
    expect(c.kind).toBe("not_checked_in");
    expect(c.shouldWrite).toBe(false);
  });

  it("opens OT for a mustered worker against their own team", () => {
    const c = classifyScan(onOther({ outAt: "2026-07-26T10:13:00Z" }), "w1", OT_IN);
    expect(c.kind).toBe("ot_opened");
    expect(c.shouldWrite).toBe(true);
    expect(c.teamId).toBe(OTHER);
  });

  it("does not re-open an OT session that is already running (today's live defect, at sweep speed)", () => {
    const c = classifyScan(
      onOther({ ot: { inAt: "2026-07-26T10:25:00Z", outAt: null } }),
      "w1",
      OT_IN,
    );
    expect(c.kind).toBe("ot_already_open");
    expect(c.shouldWrite).toBe(false);
  });

  it("closes a running OT session", () => {
    const c = classifyScan(
      onOther({ ot: { inAt: "2026-07-26T10:25:00Z", outAt: null } }),
      "w1",
      OT_OUT,
    );
    expect(c.kind).toBe("ot_closed");
    expect(c.shouldWrite).toBe(true);
    expect(c.teamId).toBe(OTHER);
  });

  it("refuses an OT check-out for a worker who never opened OT", () => {
    const c = classifyScan(onOther(), "w1", OT_OUT);
    expect(c.kind).toBe("no_ot");
    expect(c.shouldWrite).toBe(false);
  });

  it("refuses either OT direction once that OT is closed — one OT session per worker per day", () => {
    const closed = onOther({ ot: { inAt: "2026-07-26T10:25:00Z", outAt: "2026-07-26T14:00:00Z" } });
    expect(classifyScan(closed, "w1", OT_OUT).kind).toBe("ot_already_closed");
    expect(classifyScan(closed, "w1", OT_OUT).shouldWrite).toBe(false);
    expect(classifyScan(closed, "w1", OT_IN).kind).toBe("ot_already_closed");
    expect(classifyScan(closed, "w1", OT_IN).shouldWrite).toBe(false);
  });

  it("still reports an unknown badge in an evening round", () => {
    const c = classifyScan(ctx({ teamId: null }), "nope", OUT);
    expect(c.kind).toBe("unknown_badge");
    expect(c.shouldWrite).toBe(false);
  });

  it("answers from THIS sweep for a badge already written, since the board is stale until the sheet closes", () => {
    const written = ctx({
      teamId: null,
      todayTeamByWorker: new Map([["w1", OTHER]]),
      sessionByWorker: new Map([["w1", { teamId: OTHER, outAt: null, ot: null }]]),
      addedThisSweep: new Set(["w1"]),
    });
    expect(classifyScan(written, "w1", OUT).kind).toBe("already_out");
    expect(classifyScan(written, "w1", OUT).shouldWrite).toBe(false);
  });

  // A sweep carries ONE action (the toggles are behind the modal sheet; changing
  // round closes it, which resets the sweep), so the mid-sweep refusal is the
  // "already" outcome of the round being swept — never another round's.
  it("answers a re-scan with THIS round's already-outcome, in both OT directions", () => {
    const written = (over = {}) =>
      ctx({
        teamId: null,
        todayTeamByWorker: new Map([["w1", OTHER]]),
        sessionByWorker: new Map([["w1", { teamId: OTHER, outAt: null, ot: null, ...over }]]),
        addedThisSweep: new Set(["w1"]),
      });
    expect(classifyScan(written(), "w1", OT_IN).kind).toBe("ot_already_open");
    expect(classifyScan(written(), "w1", OT_IN).shouldWrite).toBe(false);
    // Board says no OT (stale — this sweep opened it), and an OT-out re-scan must
    // still refuse: a ten-second OT is the 2026-07-26 defect, and ot_hours is
    // computed from that span at scan-out.
    expect(classifyScan(written(), "w1", OT_OUT).kind).toBe("ot_already_closed");
    expect(classifyScan(written(), "w1", OT_OUT).shouldWrite).toBe(false);
  });

  it("leaves the morning path writing against the CHOSEN team", () => {
    const c = classifyScan(ctx(), "w1", { session: "regular", direction: "in" });
    expect(c.kind).toBe("added_first_time");
    expect(c.shouldWrite).toBe(true);
    expect(c.teamId).toBe(TEAM);
  });
});

describe("isCoolingDown", () => {
  it("is false for a badge never seen", () => {
    expect(isCoolingDown(EMPTY_SWEEP, "w1", 1_000)).toBe(false);
  });

  it("suppresses a repeat inside the window and admits it after", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    expect(isCoolingDown(s, "w1", 1_000 + SCAN_COOLDOWN_MS - 1)).toBe(true);
    expect(isCoolingDown(s, "w1", 1_000 + SCAN_COOLDOWN_MS)).toBe(false);
  });

  it("does not suppress a DIFFERENT badge", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    expect(isCoolingDown(s, "w2", 1_100)).toBe(false);
  });
});

describe("recordScan", () => {
  it("puts the newest entry first", () => {
    let s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    s = recordScan(s, classifyScan(ctx(), "w2", MORNING), 5_000);
    expect(s.entries.map((e) => e.workerId)).toEqual(["w2", "w1"]);
  });

  it("tracks only successfully-writable scans in addedIds", () => {
    let s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    s = recordScan(
      s,
      classifyScan(ctx({ todayTeamByWorker: new Map([["w2", OTHER]]) }), "w2", MORNING),
      2_000,
    );
    expect(s.addedIds).toEqual(["w1"]);
  });

  it("does not mutate the previous state", () => {
    const before = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    const snapshot = before.entries.length;
    recordScan(before, classifyScan(ctx(), "w2", MORNING), 2_000);
    expect(before.entries.length).toBe(snapshot);
  });
});

describe("markFailed", () => {
  it("flips the worker's newest entry to failed and drops it from addedIds", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    const f = markFailed(s, "w1", "ไม่มีสิทธิ์เช็คชื่อ");
    expect(f.entries[0]?.outcome).toBe("failed");
    expect(f.entries[0]?.detail).toBe("ไม่มีสิทธิ์เช็คชื่อ");
    expect(f.addedIds).toEqual([]);
  });

  it("is a no-op for a worker with no entry", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    expect(markFailed(s, "w9", "x")).toEqual(s);
  });
});

describe("markMoved", () => {
  it("turns an other-team entry into an added one", () => {
    const s = recordScan(
      EMPTY_SWEEP,
      classifyScan(ctx({ todayTeamByWorker: new Map([["w1", OTHER]]) }), "w1", MORNING),
      1_000,
    );
    expect(s.addedIds).toEqual([]);
    const m = markMoved(s, "w1");
    expect(m.entries[0]?.outcome).toBe("added");
    expect(m.entries[0]?.detail).toBeNull();
    expect(m.addedIds).toEqual(["w1"]);
  });

  it("is a no-op for a worker with no entry", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    expect(markMoved(s, "w9")).toEqual(s);
  });

  it("does not double-add a worker already counted", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1", MORNING), 1_000);
    expect(markMoved(s, "w1").addedIds).toEqual(["w1"]);
  });
});
