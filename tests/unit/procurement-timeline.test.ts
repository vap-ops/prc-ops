// Writing failing test first.
//
// Spec 327 U4 — the procurement timeline projection (pure). WP bars ride the
// spec-92 gantt-scale math (buildTimeline/barFor — near-full reuse, NOT a
// ScheduleGantt drop-in); PR pins place at their eta via barFor with a
// same-start/end window (the spec-255 activityGeom precedent) and attach to
// their ADR-0065 anchor WP's lane; anchorless pins ride one คลัง lane on top.
// Shelves catch what the axis can't place: undated WPs (ยังไม่กำหนดวันที่) and
// active no-eta PRs (ไม่ทราบวันถึง) — nothing dropped (§0.1).

import { describe, expect, it } from "vitest";

import { barFor } from "@/lib/work-packages/gantt-scale";
import {
  buildProcurementTimeline,
  type TimelineWpInput,
} from "@/lib/purchasing/procurement-timeline";
import type { TimePrRow } from "@/lib/purchasing/time-view";

const TODAY = "2026-07-16";

const WPS: TimelineWpInput[] = [
  {
    id: "wp1",
    code: "WP-01",
    name: "งานเสาเข็ม",
    plannedStart: "2026-07-10",
    plannedEnd: "2026-07-20",
    isGroup: false,
  },
  {
    id: "wp-undated",
    code: "WP-02",
    name: "งานลอย",
    plannedStart: null,
    plannedEnd: null,
    isGroup: false,
  },
  {
    id: "wp-oneday",
    code: "WP-03",
    name: "งานวันเดียว",
    plannedStart: "2026-07-15",
    plannedEnd: "2026-07-15",
    isGroup: false,
  },
];

let seq = 0;
function pr(overrides: Partial<TimePrRow>): TimePrRow {
  seq += 1;
  return {
    id: `pr-${seq}`,
    prNumber: seq,
    itemDescription: `รายการ ${seq}`,
    status: "on_route",
    eta: "2026-07-18",
    workPackageId: "wp1",
    requestedFromWorkPackageId: null,
    ...overrides,
  };
}

describe("buildProcurementTimeline", () => {
  it("places dated WPs as lanes with barFor geometry; a 1-day window gets a 1-day bar", () => {
    const m = buildProcurementTimeline(WPS, [], "week", TODAY);
    const lane = m.lanes.find((l) => l.wp.id === "wp-oneday");
    const expected = barFor(
      { plannedStart: "2026-07-15", plannedEnd: "2026-07-15" },
      m.timeline.domainStartMs,
      m.timeline.dayWidth,
    );
    expect(lane?.bar).toEqual(expected);
    expect(expected?.width).toBe(m.timeline.dayWidth);
  });

  it("pin x equals the barFor same-start/end math and lands on the anchor WP's lane", () => {
    const row = pr({ eta: "2026-07-18" });
    const m = buildProcurementTimeline(WPS, [row], "week", TODAY);
    const lane = m.lanes.find((l) => l.wp.id === "wp1");
    const expected = barFor(
      { plannedStart: "2026-07-18", plannedEnd: "2026-07-18" },
      m.timeline.domainStartMs,
      m.timeline.dayWidth,
    );
    expect(lane?.pins).toHaveLength(1);
    expect(lane?.pins[0]?.x).toBe(expected!.x);
  });

  it("attaches a store-bound PR's pin via the requested_from anchor (ADR 0065)", () => {
    const row = pr({ workPackageId: null, requestedFromWorkPackageId: "wp1" });
    const m = buildProcurementTimeline(WPS, [row], "week", TODAY);
    expect(m.lanes.find((l) => l.wp.id === "wp1")?.pins).toHaveLength(1);
    expect(m.storeLane).toHaveLength(0);
  });

  it("routes anchorless and foreign-anchor pins to the คลัง lane (§0.1)", () => {
    const rows = [
      pr({ workPackageId: null, requestedFromWorkPackageId: null }),
      pr({ workPackageId: "wp-foreign" }),
    ];
    const m = buildProcurementTimeline(WPS, rows, "week", TODAY);
    expect(m.storeLane).toHaveLength(2);
  });

  it("shelves undated WPs and active no-eta PRs; done/closed PRs appear nowhere", () => {
    const rows = [
      pr({ eta: null }), // active, no eta → shelf
      pr({ status: "delivered", eta: "2026-07-18" }), // done → nowhere
      pr({ status: "cancelled", eta: null }), // closed → nowhere
    ];
    const m = buildProcurementTimeline(WPS, rows, "week", TODAY);
    expect(m.undatedWps.map((w) => w.id)).toEqual(["wp-undated"]);
    expect(m.noEtaPrs).toHaveLength(1);
    const pinCount = m.lanes.reduce((n, l) => n + l.pins.length, 0) + m.storeLane.length;
    expect(pinCount).toBe(0);
  });

  it("marks a pin late when its eta lands after the anchor WP's planned start (SSOT)", () => {
    const late = pr({ eta: "2026-07-18" }); // after wp1 start 07-10
    const fine = pr({ eta: "2026-07-05" });
    const m = buildProcurementTimeline(WPS, [late, fine], "week", TODAY);
    const pins = m.lanes.find((l) => l.wp.id === "wp1")?.pins ?? [];
    expect(pins.find((p) => p.id === late.id)?.late).toBe(true);
    expect(pins.find((p) => p.id === fine.id)?.late).toBe(false);
  });

  it("widens the timeline domain to include pin etas beyond every WP window", () => {
    const far = pr({ eta: "2026-12-25" });
    const m = buildProcurementTimeline(WPS, [far], "week", TODAY);
    const expected = barFor(
      { plannedStart: "2026-12-25", plannedEnd: "2026-12-25" },
      m.timeline.domainStartMs,
      m.timeline.dayWidth,
    );
    // In-domain ⇒ barFor resolves and x sits inside the drawn width.
    expect(expected).not.toBeNull();
    expect(expected!.x).toBeLessThan(m.timeline.widthPx);
    expect(m.lanes.find((l) => l.wp.id === "wp1")?.pins[0]?.x).toBe(expected!.x);
  });
});
