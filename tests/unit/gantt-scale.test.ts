// Spec 92 Unit D — Gantt timeline scale pins: bar geometry (inclusive days),
// month-padded domain, day ticks only in month view, today position + past width.

import { describe, it, expect } from "vitest";
import { buildTimeline, barFor, SCHEDULE_PERIODS } from "@/lib/work-packages/gantt-scale";

const ITEMS = [
  { plannedStart: "2026-07-05", plannedEnd: "2026-07-14" },
  { plannedStart: "2026-08-01", plannedEnd: "2026-08-10" },
];

describe("gantt-scale", () => {
  it("pads the domain to whole months and lays out month bands", () => {
    const tl = buildTimeline(ITEMS, "month", "2026-07-20");
    // domain starts at 2026-07-01
    expect(new Date(tl.domainStartMs).toISOString().slice(0, 10)).toBe("2026-07-01");
    // July + August bands
    expect(tl.months.length).toBe(2);
    expect(tl.months[0]?.x).toBe(0);
    // Buddhist year: 2026 + 543 = 2569 → "69"
    expect(tl.months[0]?.label).toContain("69");
    // 31 (Jul) + 31 (Aug) days * 30px
    expect(tl.widthPx).toBe(62 * 30);
  });

  it("barFor places a WP by inclusive days from the domain start", () => {
    const tl = buildTimeline(ITEMS, "month", "2026-07-20");
    const bar = barFor(ITEMS[0]!, tl.domainStartMs, tl.dayWidth);
    // starts day 4 (Jul 5 is the 5th, index 4 from Jul 1) * 30
    expect(bar?.x).toBe(4 * 30);
    // Jul 5..14 inclusive = 10 days * 30
    expect(bar?.width).toBe(10 * 30);
  });

  it("returns null bar for an unscheduled WP", () => {
    expect(barFor({ plannedStart: null, plannedEnd: null }, 0, 30)).toBeNull();
  });

  it("computes today position + past shading width", () => {
    const tl = buildTimeline(ITEMS, "month", "2026-07-20");
    // Jul 20 is index 19 from Jul 1
    expect(tl.todayX).toBe(19 * 30);
    expect(tl.pastWidth).toBe(19 * 30);
  });

  it("shows day ticks only in month view", () => {
    expect(buildTimeline(ITEMS, "month", "2026-07-20").days.length).toBeGreaterThan(0);
    expect(buildTimeline(ITEMS, "quarter", "2026-07-20").days.length).toBe(0);
    expect(buildTimeline(ITEMS, "year", "2026-07-20").days.length).toBe(0);
  });

  it("empty input yields an empty timeline", () => {
    const tl = buildTimeline([], "month", "2026-07-20");
    expect(tl.widthPx).toBe(0);
    expect(tl.months.length).toBe(0);
  });

  it("exposes the three Thai period labels", () => {
    expect(SCHEDULE_PERIODS.map((p) => p.label)).toEqual(["เดือน", "ไตรมาส", "ปี"]);
  });
});
