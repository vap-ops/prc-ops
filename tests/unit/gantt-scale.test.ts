// Spec 92 Unit D — Gantt timeline scale pins: bar geometry (inclusive days),
// month-padded domain, day ticks (day + week views, not month), today position +
// past width, the วัน/สัปดาห์/เดือน period labels.

import { describe, it, expect } from "vitest";
import { buildTimeline, barFor, SCHEDULE_PERIODS } from "@/lib/work-packages/gantt-scale";

const ITEMS = [
  { plannedStart: "2026-07-05", plannedEnd: "2026-07-14" },
  { plannedStart: "2026-08-01", plannedEnd: "2026-08-10" },
];

describe("gantt-scale", () => {
  it("pads the domain to whole months and lays out month bands", () => {
    const tl = buildTimeline(ITEMS, "day", "2026-07-20");
    expect(new Date(tl.domainStartMs).toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(tl.months.length).toBe(2);
    expect(tl.months[0]?.x).toBe(0);
    // Buddhist year: 2026 + 543 = 2569 → "69"
    expect(tl.months[0]?.label).toContain("69");
    // 31 (Jul) + 31 (Aug) days * 44px (day view)
    expect(tl.widthPx).toBe(62 * 44);
  });

  it("barFor places a WP by inclusive days from the domain start", () => {
    const tl = buildTimeline(ITEMS, "day", "2026-07-20");
    const bar = barFor(ITEMS[0]!, tl.domainStartMs, tl.dayWidth);
    // Jul 5 is index 4 from Jul 1
    expect(bar?.x).toBe(4 * 44);
    // Jul 5..14 inclusive = 10 days
    expect(bar?.width).toBe(10 * 44);
  });

  it("returns null bar for an unscheduled WP", () => {
    expect(barFor({ plannedStart: null, plannedEnd: null }, 0, 44)).toBeNull();
  });

  it("computes today position + past shading width", () => {
    const tl = buildTimeline(ITEMS, "day", "2026-07-20");
    // Jul 20 is index 19 from Jul 1
    expect(tl.todayX).toBe(19 * 44);
    expect(tl.pastWidth).toBe(19 * 44);
  });

  it("shows day ticks in day + week views, not in the month view", () => {
    expect(buildTimeline(ITEMS, "day", "2026-07-20").days.length).toBeGreaterThan(0);
    expect(buildTimeline(ITEMS, "week", "2026-07-20").days.length).toBeGreaterThan(0);
    expect(buildTimeline(ITEMS, "month", "2026-07-20").days.length).toBe(0);
  });

  it("empty input yields an empty timeline", () => {
    const tl = buildTimeline([], "day", "2026-07-20");
    expect(tl.widthPx).toBe(0);
    expect(tl.months.length).toBe(0);
  });

  it("exposes the three Thai period labels (day / week / month)", () => {
    expect(SCHEDULE_PERIODS.map((p) => p.label)).toEqual(["วัน", "สัปดาห์", "เดือน"]);
  });
});
