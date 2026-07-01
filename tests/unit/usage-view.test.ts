import { describe, expect, it } from "vitest";
import { formatScreenTime, summarizeUsage, type UsageDailyRow } from "@/lib/usage/usage-view";

// Spec 244 U1b-2 — pure view helpers behind the super_admin usage read. They
// turn usage_daily rows into a DAU-per-day series + a per-SA summary, and format
// screen time for humans (Thai). Kept pure/date-injected so they are testable.

describe("formatScreenTime", () => {
  it("shows 0 นาที for no time", () => {
    expect(formatScreenTime(0)).toBe("0 นาที");
  });
  it("shows seconds under a minute", () => {
    expect(formatScreenTime(5_000)).toBe("5 วินาที");
    expect(formatScreenTime(45_000)).toBe("45 วินาที");
  });
  it("shows whole minutes under an hour", () => {
    expect(formatScreenTime(60_000)).toBe("1 นาที");
    expect(formatScreenTime(600_000)).toBe("10 นาที");
  });
  it("shows hours (+minutes) at an hour or more", () => {
    expect(formatScreenTime(3_600_000)).toBe("1 ชม.");
    expect(formatScreenTime(3_900_000)).toBe("1 ชม. 5 นาที");
    expect(formatScreenTime(5_400_000)).toBe("1 ชม. 30 นาที");
  });
});

describe("summarizeUsage", () => {
  const window = ["2026-06-29", "2026-06-30", "2026-07-01"];
  const rows: UsageDailyRow[] = [
    {
      actorId: "a",
      name: "Anan",
      role: "site_admin",
      day: "2026-06-30",
      sessions: 2,
      active: true,
      screenTimeMs: 80_000,
    },
    {
      actorId: "a",
      name: "Anan",
      role: "site_admin",
      day: "2026-07-01",
      sessions: 1,
      active: true,
      screenTimeMs: 40_000,
    },
    {
      actorId: "b",
      name: "Boon",
      role: "project_manager",
      day: "2026-07-01",
      sessions: 1,
      active: true,
      screenTimeMs: 20_000,
    },
    // an inactive day-row must NOT count toward DAU / active days
    {
      actorId: "c",
      name: "Chai",
      role: "procurement",
      day: "2026-06-29",
      sessions: 0,
      active: false,
      screenTimeMs: 0,
    },
  ];

  it("builds a DAU point per window day, counting only active actors", () => {
    const { dau } = summarizeUsage(rows, window);
    expect(dau).toEqual([
      { day: "2026-06-29", count: 0 },
      { day: "2026-06-30", count: 1 },
      { day: "2026-07-01", count: 2 },
    ]);
  });

  it("reports peak DAU and total distinct active SAs", () => {
    const s = summarizeUsage(rows, window);
    expect(s.peakDau).toBe(2);
    expect(s.totalActiveSas).toBe(2); // a + b; c never active
  });

  it("summarizes each SA (sorted by name), with active days, totals and last-seen", () => {
    const { perSa } = summarizeUsage(rows, window);
    expect(perSa.map((p) => p.actorId)).toEqual(["a", "b", "c"]);
    expect(perSa[0]).toEqual({
      actorId: "a",
      name: "Anan",
      role: "site_admin",
      activeDays: 2,
      totalScreenTimeMs: 120_000,
      totalSessions: 3,
      lastActiveDay: "2026-07-01",
    });
    expect(perSa[2]).toEqual({
      actorId: "c",
      name: "Chai",
      role: "procurement",
      activeDays: 0,
      totalScreenTimeMs: 0,
      totalSessions: 0,
      lastActiveDay: null,
    });
  });

  it("handles an empty window with no rows", () => {
    const s = summarizeUsage([], window);
    expect(s.dau).toEqual([
      { day: "2026-06-29", count: 0 },
      { day: "2026-06-30", count: 0 },
      { day: "2026-07-01", count: 0 },
    ]);
    expect(s.perSa).toEqual([]);
    expect(s.peakDau).toBe(0);
    expect(s.totalActiveSas).toBe(0);
  });
});
