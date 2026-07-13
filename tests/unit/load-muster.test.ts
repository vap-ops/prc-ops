// Writing failing test first.
//
// Spec 306 U3 — shapeMusterBoard is the pure transform behind the muster cockpit
// reader: it folds the flat rows (teams, attendance, team-WPs, workers, WPs) into
// the per-team view the screen renders (lead + members with scan times + WP set),
// plus the worker picker list and the WP-chip options. Names resolve off the
// workers list; a referenced id not in it falls back to "—" (never throws).

import { describe, expect, it } from "vitest";

import { shapeMusterBoard } from "@/lib/muster/load-muster";

const WORKERS = [
  { id: "w1", name: "ลี" },
  { id: "w2", name: "สมชาย" },
  { id: "w3", name: "ก้อง" },
];
const WPS = [
  { id: "wpA", code: "A", name: "งานเอ" },
  { id: "wpB", code: "B", name: "งานบี" },
];

describe("shapeMusterBoard", () => {
  it("folds attendance + team-WPs into per-team members and wp sets", () => {
    const board = shapeMusterBoard({
      teams: [{ id: "t1", lead_worker_id: "w1" }],
      attendance: [
        {
          team_id: "t1",
          worker_id: "w1",
          in_at: "2026-07-13T01:00:00Z",
          out_at: null,
          ot_hours: null,
        },
        {
          team_id: "t1",
          worker_id: "w2",
          in_at: "2026-07-13T01:05:00Z",
          out_at: "2026-07-13T11:00:00Z",
          ot_hours: 1.5,
        },
      ],
      teamWps: [{ team_id: "t1", work_package_id: "wpA" }],
      workers: WORKERS,
      wps: WPS,
    });

    expect(board.teams).toHaveLength(1);
    const team = board.teams[0]!;
    expect(team.leadWorkerId).toBe("w1");
    expect(team.leadName).toBe("ลี");
    expect(team.wpIds).toEqual(["wpA"]);
    expect(team.members.map((m) => m.workerId)).toEqual(["w1", "w2"]);
    const m2 = team.members.find((m) => m.workerId === "w2")!;
    expect(m2.name).toBe("สมชาย");
    expect(m2.outAt).toBe("2026-07-13T11:00:00Z");
    expect(m2.otHours).toBe(1.5);
    // Picker + WP options pass through untouched.
    expect(board.workers).toEqual(WORKERS);
    expect(board.wps).toEqual(WPS);
  });

  it("groups members by their own team and never crosses teams", () => {
    const board = shapeMusterBoard({
      teams: [
        { id: "t1", lead_worker_id: "w1" },
        { id: "t2", lead_worker_id: "w3" },
      ],
      attendance: [
        { team_id: "t1", worker_id: "w1", in_at: "x", out_at: null, ot_hours: null },
        { team_id: "t2", worker_id: "w3", in_at: "y", out_at: null, ot_hours: null },
        { team_id: "t2", worker_id: "w2", in_at: "z", out_at: null, ot_hours: null },
      ],
      teamWps: [],
      workers: WORKERS,
      wps: WPS,
    });

    const t1 = board.teams.find((t) => t.id === "t1")!;
    const t2 = board.teams.find((t) => t.id === "t2")!;
    expect(t1.members.map((m) => m.workerId)).toEqual(["w1"]);
    expect(t2.members.map((m) => m.workerId).sort()).toEqual(["w2", "w3"]);
    expect(t2.leadName).toBe("ก้อง");
  });

  it("falls back to — for a worker id missing from the workers list", () => {
    const board = shapeMusterBoard({
      teams: [{ id: "t1", lead_worker_id: "ghost" }],
      attendance: [{ team_id: "t1", worker_id: "ghost", in_at: "x", out_at: null, ot_hours: null }],
      teamWps: [],
      workers: WORKERS,
      wps: WPS,
    });
    expect(board.teams[0]!.leadName).toBe("—");
    expect(board.teams[0]!.members[0]!.name).toBe("—");
  });
});
