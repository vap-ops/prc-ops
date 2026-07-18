// Writing failing test first.
//
// Spec 327 U3 — the เวลา view's pure core: the late-risk LIST (the U1 SSOT's
// flagged rows, enriched with their anchor WP + ordered most-late first) and
// the week radar (arrivals this week × WPs starting/running this week,
// Sunday-first weekOf convention). The ?view= sub-view param parses like
// IncomingLens — a sub-ROUTE would double-light the bottom tab.

import { describe, expect, it } from "vitest";

import {
  buildLateRiskList,
  buildWeekRadar,
  parseTimeView,
  type TimePrRow,
} from "@/lib/purchasing/time-view";

const WPS = [
  { id: "wp1", name: "งานเสาเข็ม", plannedStart: "2026-07-10", plannedEnd: "2026-07-30" },
  { id: "wp2", name: "งานหลังคา", plannedStart: null, plannedEnd: null },
];

let seq = 0;
function pr(overrides: Partial<TimePrRow>): TimePrRow {
  seq += 1;
  return {
    id: `pr-${seq}`,
    prNumber: seq,
    itemDescription: `รายการ ${seq}`,
    status: "approved",
    eta: "2026-07-20",
    workPackageId: "wp1",
    requestedFromWorkPackageId: null,
    ...overrides,
  };
}

describe("parseTimeView", () => {
  it("defaults to late; accepts week; garbage falls back", () => {
    expect(parseTimeView(undefined)).toBe("late");
    expect(parseTimeView("week")).toBe("week");
    expect(parseTimeView("nonsense")).toBe("late");
  });
});

describe("buildLateRiskList", () => {
  it("returns only SSOT-flagged rows, enriched with the anchor WP + daysLate", () => {
    const flagged = pr({ eta: "2026-07-20" }); // 10 days after wp1 start
    const fine = pr({ eta: "2026-07-01" });
    const out = buildLateRiskList([flagged, fine], WPS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: flagged.id,
      wpName: "งานเสาเข็ม",
      plannedStart: "2026-07-10",
      daysLate: 10,
    });
  });

  it("orders most-late first", () => {
    const worst = pr({ eta: "2026-08-09" }); // 30 days
    const mild = pr({ eta: "2026-07-12" }); // 2 days
    const middle = pr({ eta: "2026-07-25" }); // 15 days
    const out = buildLateRiskList([mild, worst, middle], WPS);
    expect(out.map((r) => r.id)).toEqual([worst.id, middle.id, mild.id]);
  });

  it("includes a store-bound PR via the requested_from anchor (ADR 0065, again at this grain)", () => {
    const storeBound = pr({ workPackageId: null, requestedFromWorkPackageId: "wp1" });
    expect(buildLateRiskList([storeBound], WPS)).toHaveLength(1);
  });

  it("never flags undated-WP or done/closed rows", () => {
    const undatedAnchor = pr({ workPackageId: "wp2" });
    const done = pr({ status: "delivered" });
    const closed = pr({ status: "cancelled" });
    expect(buildLateRiskList([undatedAnchor, done, closed], WPS)).toHaveLength(0);
  });
});

describe("buildWeekRadar", () => {
  // Sunday 2026-07-12 → Saturday 2026-07-18.
  const WEEK = [
    "2026-07-12",
    "2026-07-13",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-18",
  ];
  const RADAR_WPS = [
    { id: "a", name: "เริ่มสัปดาห์นี้", plannedStart: "2026-07-14", plannedEnd: "2026-08-01" },
    { id: "b", name: "กำลังทำต่อเนื่อง", plannedStart: "2026-07-01", plannedEnd: "2026-07-16" },
    { id: "c", name: "เปิดไม่มีวันจบ", plannedStart: "2026-07-01", plannedEnd: null },
    { id: "d", name: "จบไปแล้ว", plannedStart: "2026-06-01", plannedEnd: "2026-07-05" },
    { id: "e", name: "ยังไม่เริ่ม", plannedStart: "2026-08-01", plannedEnd: "2026-08-20" },
    { id: "f", name: "ไม่มีวันที่", plannedStart: null, plannedEnd: null },
  ];

  it("collects in_transit arrivals with an in-week eta, sorted by eta", () => {
    const rows = [
      pr({ status: "on_route", eta: "2026-07-15" }),
      pr({ status: "purchased", eta: "2026-07-13" }),
      pr({ status: "on_route", eta: "2026-07-25" }), // out of week
      pr({ status: "on_route", eta: null }), // no eta → not placeable
      pr({ status: "delivered", eta: "2026-07-15" }), // done band → not an arrival
      pr({ status: "approved", eta: "2026-07-15" }), // to_order → not shipped yet
    ];
    const { arrivals } = buildWeekRadar(RADAR_WPS, rows, WEEK);
    expect(arrivals.map((a) => a.eta)).toEqual(["2026-07-13", "2026-07-15"]);
  });

  it("collects WPs overlapping the week — starting, running, and open-ended; excludes ended/future/undated", () => {
    const { weekWps } = buildWeekRadar(RADAR_WPS, [], WEEK);
    expect(weekWps.map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(weekWps.find((w) => w.id === "a")?.startsThisWeek).toBe(true);
    expect(weekWps.find((w) => w.id === "b")?.startsThisWeek).toBe(false);
  });
});
