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
  recordScan,
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
    ...over,
  };
}

describe("classifyScan", () => {
  it("adds a worker with no prior muster as first-time", () => {
    const c = classifyScan(ctx(), "w1");
    expect(c.kind).toBe("added_first_time");
    expect(c.name).toBe("จรูญ โสภา");
    expect(c.shouldWrite).toBe(true);
  });

  it("adds a worker whose last muster was this same lead, with no warning", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_A, name: "อนันต์ แสงทอง" }]]) }),
      "w1",
    );
    expect(c.kind).toBe("added");
    expect(c.detail).toBeNull();
    expect(c.shouldWrite).toBe(true);
  });

  it("warns when the worker's last muster was a different lead", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_B, name: "จันทร์ เงางาม" }]]) }),
      "w1",
    );
    expect(c.kind).toBe("added_team_changed");
    expect(c.detail).toBe("จันทร์ เงางาม");
    expect(c.shouldWrite).toBe(true);
  });

  it("compares leads by ID, not display name — two leads may share a name", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_B, name: "อนันต์ แสงทอง" }]]) }),
      "w1",
    );
    expect(c.kind).toBe("added_team_changed");
  });

  it("reports a worker already on THIS team without writing", () => {
    const c = classifyScan(ctx({ todayTeamByWorker: new Map([["w1", TEAM]]) }), "w1");
    expect(c.kind).toBe("already_here");
    expect(c.shouldWrite).toBe(false);
  });

  it("counts a worker added earlier in this same sweep as already here", () => {
    const c = classifyScan(ctx({ addedThisSweep: new Set(["w1"]) }), "w1");
    expect(c.kind).toBe("already_here");
    expect(c.shouldWrite).toBe(false);
  });

  it("names the other team when the worker is mustered elsewhere today", () => {
    const c = classifyScan(ctx({ todayTeamByWorker: new Map([["w1", OTHER]]) }), "w1");
    expect(c.kind).toBe("other_team");
    expect(c.detail).toBe("จันทร์ เงางาม");
    expect(c.shouldWrite).toBe(false);
  });

  it("rejects a payload that is not a known worker", () => {
    const c = classifyScan(ctx(), "not-a-worker");
    expect(c.kind).toBe("unknown_badge");
    expect(c.shouldWrite).toBe(false);
  });
});

describe("isCoolingDown", () => {
  it("is false for a badge never seen", () => {
    expect(isCoolingDown(EMPTY_SWEEP, "w1", 1_000)).toBe(false);
  });

  it("suppresses a repeat inside the window and admits it after", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(isCoolingDown(s, "w1", 1_000 + SCAN_COOLDOWN_MS - 1)).toBe(true);
    expect(isCoolingDown(s, "w1", 1_000 + SCAN_COOLDOWN_MS)).toBe(false);
  });

  it("does not suppress a DIFFERENT badge", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(isCoolingDown(s, "w2", 1_100)).toBe(false);
  });
});

describe("recordScan", () => {
  it("puts the newest entry first", () => {
    let s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    s = recordScan(s, classifyScan(ctx(), "w2"), 5_000);
    expect(s.entries.map((e) => e.workerId)).toEqual(["w2", "w1"]);
  });

  it("tracks only successfully-writable scans in addedIds", () => {
    let s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    s = recordScan(
      s,
      classifyScan(ctx({ todayTeamByWorker: new Map([["w2", OTHER]]) }), "w2"),
      2_000,
    );
    expect(s.addedIds).toEqual(["w1"]);
  });

  it("does not mutate the previous state", () => {
    const before = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    const snapshot = before.entries.length;
    recordScan(before, classifyScan(ctx(), "w2"), 2_000);
    expect(before.entries.length).toBe(snapshot);
  });
});

describe("markFailed", () => {
  it("flips the worker's newest entry to failed and drops it from addedIds", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    const f = markFailed(s, "w1", "ไม่มีสิทธิ์เช็คชื่อ");
    expect(f.entries[0]?.outcome).toBe("failed");
    expect(f.entries[0]?.detail).toBe("ไม่มีสิทธิ์เช็คชื่อ");
    expect(f.addedIds).toEqual([]);
  });

  it("is a no-op for a worker with no entry", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(markFailed(s, "w9", "x")).toEqual(s);
  });
});
