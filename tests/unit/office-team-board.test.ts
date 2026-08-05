// Spec 397 U5 — the office team's own board.
//
// The cockpit board EXCLUDES office teams (U4), and rightly: it groups by
// หัวหน้าชุด and an office team is leadless. So the office team needs its own
// shape — and it is a different shape, not a copy: no lead, no WP set, no crew
// roster, no ยังไม่มา list (an office team has no roster to be absent from).
//
// `shapeOfficeBoard` is the pure fold; the fetch around it is thin.

import { describe, expect, it } from "vitest";

import { shapeOfficeBoard } from "@/lib/muster/office-board";

const WORKERS = [
  { id: "w1", name: "ธุรการ หนึ่ง" },
  { id: "w2", name: "ธุรการ สอง" },
  { id: "w3", name: "ผู้ตรวจ" },
];

describe("shapeOfficeBoard", () => {
  it("no team yet → not opened, nobody in, everyone addable", () => {
    const b = shapeOfficeBoard({ team: null, attendance: [], workers: WORKERS, mustered: [] });
    expect(b.teamId).toBeNull();
    expect(b.members).toEqual([]);
    expect(b.addable.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("folds attendance into members, newest check-in last", () => {
    const b = shapeOfficeBoard({
      team: { id: "t1" },
      attendance: [
        { worker_id: "w2", in_at: "2026-08-05T02:10:00Z", out_at: null },
        { worker_id: "w1", in_at: "2026-08-05T01:00:00Z", out_at: "2026-08-05T10:00:00Z" },
      ],
      workers: WORKERS,
      mustered: [],
    });
    expect(b.teamId).toBe("t1");
    expect(b.members.map((m) => m.workerId)).toEqual(["w1", "w2"]);
    expect(b.members[0]?.name).toBe("ธุรการ หนึ่ง");
    expect(b.members[0]?.outAt).not.toBeNull();
    expect(b.members[1]?.outAt).toBeNull();
  });

  it("a member is not offered again in the add list", () => {
    const b = shapeOfficeBoard({
      team: { id: "t1" },
      attendance: [{ worker_id: "w1", in_at: "2026-08-05T01:00:00Z", out_at: null }],
      workers: WORKERS,
      mustered: [],
    });
    expect(b.addable.map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("someone already mustered in a CREW today is not offered either", () => {
    // muster_scan_in refuses them (one team per worker per day), so offering them
    // would be an affordance whose own server says no — the defect this repo keeps
    // re-learning. They are excluded here, not refused after the tap.
    const b = shapeOfficeBoard({
      team: { id: "t1" },
      attendance: [],
      workers: WORKERS,
      mustered: ["w2"],
    });
    expect(b.addable.map((w) => w.id)).toEqual(["w1", "w3"]);
  });

  it("an unknown worker id in attendance still renders, with a fallback name", () => {
    // Same rule as the crew board: a deactivated worker with attendance must not
    // vanish from the day's record, and must not throw.
    const b = shapeOfficeBoard({
      team: { id: "t1" },
      attendance: [{ worker_id: "gone", in_at: "2026-08-05T01:00:00Z", out_at: null }],
      workers: WORKERS,
      mustered: [],
    });
    expect(b.members).toHaveLength(1);
    expect(b.members[0]?.name).toBe("—");
  });

  it("counts who is still in — the number the card leads with", () => {
    const b = shapeOfficeBoard({
      team: { id: "t1" },
      attendance: [
        { worker_id: "w1", in_at: "2026-08-05T01:00:00Z", out_at: "2026-08-05T10:00:00Z" },
        { worker_id: "w2", in_at: "2026-08-05T01:00:00Z", out_at: null },
      ],
      workers: WORKERS,
      mustered: [],
    });
    expect(b.presentCount).toBe(2); // present TODAY, not "still on site"
    expect(b.stillInCount).toBe(1);
  });
});
