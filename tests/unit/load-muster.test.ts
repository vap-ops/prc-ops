// Writing failing test first.
//
// Spec 306 U3 + spec 351 U2 — shapeMusterBoard is the pure transform behind the
// muster cockpit reader. Since spec 351 it folds TWO attendance rows per worker
// (a `regular` session + an optional `ot` session) into ONE member: the regular
// fields on the member base, the ot session under `member.ot` (null when the
// worker has no OT that day). Names resolve off the workers list; a referenced id
// not in it falls back to "—" (never throws).

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
  it("folds a worker's regular + ot rows into one member (spec 351 U2)", () => {
    const board = shapeMusterBoard({
      teams: [{ id: "t1", lead_worker_id: "w1" }],
      attendance: [
        // w1 — regular only, still in.
        {
          team_id: "t1",
          worker_id: "w1",
          session: "regular",
          in_at: "2026-07-13T01:00:00Z",
          out_at: null,
          ot_hours: null,
        },
        // w2 — regular (in + out) PLUS an ot session with a 1.5h span.
        {
          team_id: "t1",
          worker_id: "w2",
          session: "regular",
          in_at: "2026-07-13T01:05:00Z",
          out_at: "2026-07-13T09:00:00Z",
          ot_hours: null,
        },
        {
          team_id: "t1",
          worker_id: "w2",
          session: "ot",
          in_at: "2026-07-13T10:30:00Z",
          out_at: "2026-07-13T12:00:00Z",
          ot_hours: 1.5,
        },
      ],
      teamWps: [{ team_id: "t1", work_package_id: "wpA" }],
      workers: WORKERS,
      wps: WPS,
    });

    expect(board.teams).toHaveLength(1);
    const team = board.teams[0]!;
    expect(team.wpIds).toEqual(["wpA"]);
    // ONE member per worker even though w2 has two attendance rows.
    expect(team.members.map((m) => m.workerId)).toEqual(["w1", "w2"]);

    const m1 = team.members.find((m) => m.workerId === "w1")!;
    expect(m1.inAt).toBe("2026-07-13T01:00:00Z");
    expect(m1.ot).toBeNull(); // no OT session

    const m2 = team.members.find((m) => m.workerId === "w2")!;
    expect(m2.name).toBe("สมชาย");
    // Regular fields come from the regular row.
    expect(m2.inAt).toBe("2026-07-13T01:05:00Z");
    expect(m2.outAt).toBe("2026-07-13T09:00:00Z");
    // The ot session is folded under member.ot with its own span.
    expect(m2.ot).toEqual({
      inAt: "2026-07-13T10:30:00Z",
      outAt: "2026-07-13T12:00:00Z",
      otHours: 1.5,
    });
    // Picker + WP options pass through untouched.
    expect(board.workers).toEqual(WORKERS);
    expect(board.wps).toEqual(WPS);
  });

  it("an open ot session (no out) folds with a null span, member.ot present", () => {
    const board = shapeMusterBoard({
      teams: [{ id: "t1", lead_worker_id: "w1" }],
      attendance: [
        {
          team_id: "t1",
          worker_id: "w1",
          session: "regular",
          in_at: "a",
          out_at: "b",
          ot_hours: null,
        },
        { team_id: "t1", worker_id: "w1", session: "ot", in_at: "c", out_at: null, ot_hours: null },
      ],
      teamWps: [],
      workers: WORKERS,
      wps: WPS,
    });
    const m = board.teams[0]!.members[0]!;
    expect(m.outAt).toBe("b"); // regular out
    expect(m.ot).toEqual({ inAt: "c", outAt: null, otHours: null }); // OT still open
  });

  it("groups members by their own team and never crosses teams", () => {
    const board = shapeMusterBoard({
      teams: [
        { id: "t1", lead_worker_id: "w1" },
        { id: "t2", lead_worker_id: "w3" },
      ],
      attendance: [
        {
          team_id: "t1",
          worker_id: "w1",
          session: "regular",
          in_at: "x",
          out_at: null,
          ot_hours: null,
        },
        {
          team_id: "t2",
          worker_id: "w3",
          session: "regular",
          in_at: "y",
          out_at: null,
          ot_hours: null,
        },
        {
          team_id: "t2",
          worker_id: "w2",
          session: "regular",
          in_at: "z",
          out_at: null,
          ot_hours: null,
        },
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

  it("maps the day closure and each member's auto-out flag (spec 306 U4)", () => {
    const board = shapeMusterBoard({
      teams: [{ id: "t1", lead_worker_id: "w1" }],
      attendance: [
        {
          team_id: "t1",
          worker_id: "w1",
          session: "regular",
          in_at: "x",
          out_at: "y",
          ot_hours: null,
          out_auto: true,
        },
        {
          team_id: "t1",
          worker_id: "w2",
          session: "regular",
          in_at: "x",
          out_at: "z",
          ot_hours: null,
          out_auto: false,
        },
      ],
      teamWps: [],
      workers: WORKERS,
      wps: WPS,
      closure: { closed_at: "2026-07-13T10:00:00Z" },
    });
    expect(board.closure).toEqual({ closedAt: "2026-07-13T10:00:00Z" });
    const [m1, m2] = board.teams[0]!.members;
    expect(m1!.outAuto).toBe(true);
    expect(m2!.outAuto).toBe(false);
  });

  it("closure is null when the day is open", () => {
    const board = shapeMusterBoard({
      teams: [],
      attendance: [],
      teamWps: [],
      workers: [],
      wps: [],
      closure: null,
    });
    expect(board.closure).toBeNull();
  });

  it("falls back to — for a worker id missing from the workers list", () => {
    const board = shapeMusterBoard({
      teams: [{ id: "t1", lead_worker_id: "ghost" }],
      attendance: [
        {
          team_id: "t1",
          worker_id: "ghost",
          session: "regular",
          in_at: "x",
          out_at: null,
          ot_hours: null,
        },
      ],
      teamWps: [],
      workers: WORKERS,
      wps: WPS,
    });
    expect(board.teams[0]!.leadName).toBe("—");
    expect(board.teams[0]!.members[0]!.name).toBe("—");
  });
});
