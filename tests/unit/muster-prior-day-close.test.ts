// Writing failing test first.
//
// Spec 306 close-day carryover — the pure fold behind the cockpit's
// "ยังไม่ได้ปิดวันทำงานที่ผ่านมา" banner.
//
// Field failure, twice running (2026-07-24 and 2026-07-25 on PRC-2026-004): the
// SA checks everyone out — the day is "done" in their head — and never presses
// ปิดวัน, so no `muster_day_closures` row exists and the money derive can never
// fire for that date. The cockpit is hard-locked to bangkokTodayIso(), so once
// midnight passes the missed day is UI-unreachable forever. This fold finds those
// days off the rows the SA already created, so the next morning's board can offer
// to close them.
//
// A day only appears if a team was actually opened on it — days nobody mustered
// (Sunday, a holiday) have no muster_teams rows and must never be nagged about.

import { describe, expect, it } from "vitest";
import {
  shapeUnclosedPriorDays,
  carryoverWindowStart,
  CLOSE_CARRYOVER_WINDOW_DAYS,
} from "@/lib/muster/prior-day-close";

const ot = (team_id: string, over: { in_at?: string | null; out_at?: string | null } = {}) => ({
  team_id,
  session: "ot" as const,
  in_at: "2026-07-24T10:30:00Z",
  out_at: null,
  ...over,
});
const regular = (
  team_id: string,
  over: { in_at?: string | null; out_at?: string | null } = {},
) => ({
  team_id,
  session: "regular" as const,
  in_at: "2026-07-24T01:00:00Z",
  out_at: null,
  ...over,
});

describe("shapeUnclosedPriorDays", () => {
  it("lists a prior day that has teams but no closure row", () => {
    const days = shapeUnclosedPriorDays({
      priorTeams: [
        { id: "t1", work_date: "2026-07-25" },
        { id: "t2", work_date: "2026-07-25" },
      ],
      closedDates: [],
      attendance: [],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days).toEqual([{ date: "2026-07-25", teamCount: 2, openOt: 0 }]);
  });

  it("excludes a day that WAS closed — the banner is derived state, so it self-clears", () => {
    const days = shapeUnclosedPriorDays({
      priorTeams: [{ id: "t1", work_date: "2026-07-24" }],
      closedDates: ["2026-07-24"],
      attendance: [],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days).toEqual([]);
  });

  it("keeps the unclosed days and drops only the closed ones, newest first", () => {
    const days = shapeUnclosedPriorDays({
      priorTeams: [
        { id: "t1", work_date: "2026-07-20" },
        { id: "t2", work_date: "2026-07-25" },
        { id: "t3", work_date: "2026-07-24" },
      ],
      closedDates: ["2026-07-24"],
      attendance: [],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    // Newest first: the SA's most recent miss is the one they can still remember.
    expect(days.map((d) => d.date)).toEqual(["2026-07-25", "2026-07-20"]);
  });

  it("counts that day's OPEN OT sessions (in, no out) for the close confirmation", () => {
    const days = shapeUnclosedPriorDays({
      priorTeams: [{ id: "t1", work_date: "2026-07-24" }],
      closedDates: [],
      attendance: [
        ot("t1"),
        ot("t1"),
        // A closed OT session is not open — it already has its span.
        ot("t1", { out_at: "2026-07-24T13:00:00Z" }),
      ],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days[0]?.openOt).toBe(2);
  });

  it("a still-in REGULAR session is not an open OT — close_muster_day auto-outs it", () => {
    // The distinction is the whole point of the confirmation: regular stragglers
    // are handled by the auto-out at day-end, OT spans are lost for good.
    const days = shapeUnclosedPriorDays({
      priorTeams: [{ id: "t1", work_date: "2026-07-24" }],
      closedDates: [],
      attendance: [regular("t1"), regular("t1")],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days[0]?.openOt).toBe(0);
  });

  it("scopes the OT count to the day's own teams", () => {
    const days = shapeUnclosedPriorDays({
      priorTeams: [
        { id: "t1", work_date: "2026-07-25" },
        { id: "t2", work_date: "2026-07-24" },
      ],
      closedDates: [],
      attendance: [ot("t1"), ot("t2"), ot("t2")],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days.find((d) => d.date === "2026-07-25")?.openOt).toBe(1);
    expect(days.find((d) => d.date === "2026-07-24")?.openOt).toBe(2);
  });

  it("an OT row with no in_at is not an open session", () => {
    const days = shapeUnclosedPriorDays({
      priorTeams: [{ id: "t1", work_date: "2026-07-24" }],
      closedDates: [],
      attendance: [ot("t1", { in_at: null })],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days[0]?.openOt).toBe(0);
  });

  it("a day whose teams were opened but nobody scanned still needs closing", () => {
    // An abandoned team (opened by mistake, or the lineup dispersed) still leaves
    // the day open. Closing books nothing and is harmless — but it clears the nag,
    // which is the only way the banner can ever reach zero.
    const days = shapeUnclosedPriorDays({
      priorTeams: [{ id: "t1", work_date: "2026-07-24" }],
      closedDates: [],
      attendance: [],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days).toEqual([{ date: "2026-07-24", teamCount: 1, openOt: 0 }]);
  });

  it("never lists TODAY — the day in progress has its own ปิดวัน bar", () => {
    // "prior" is part of this function's contract, not something it trusts the
    // caller's query to have got right: a reader that used `lte` instead of `lt`
    // would otherwise nag the SA to close the day they are standing in.
    const days = shapeUnclosedPriorDays({
      priorTeams: [
        { id: "t1", work_date: "2026-07-26" },
        { id: "t2", work_date: "2026-07-25" },
      ],
      closedDates: [],
      attendance: [ot("t1")],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days.map((d) => d.date)).toEqual(["2026-07-25"]);
  });

  it("never lists a FUTURE work_date either", () => {
    const days = shapeUnclosedPriorDays({
      priorTeams: [{ id: "t1", work_date: "2026-07-27" }],
      closedDates: [],
      attendance: [],
      today: "2026-07-26",
      since: "2026-06-26",
    });
    expect(days).toEqual([]);
  });

  it("ignores a day older than the carry-over window", () => {
    // The banner is the SA's DAILY nudge, so it is bounded: without a floor this
    // reader would fetch every muster day the project has ever had, on every
    // cockpit load, forever. Anything older than the window is a payroll-audit
    // matter and shows up on /team/attendance's unclosed-day signal instead —
    // a boundary, not a silent truncation.
    const days = shapeUnclosedPriorDays({
      priorTeams: [
        { id: "old", work_date: "2026-05-01" },
        { id: "recent", work_date: "2026-07-25" },
      ],
      closedDates: [],
      attendance: [],
      today: "2026-07-26",
      since: carryoverWindowStart("2026-07-26"),
    });
    expect(days.map((d) => d.date)).toEqual(["2026-07-25"]);
  });

  it("includes the first day of the window (the boundary is inclusive)", () => {
    const since = carryoverWindowStart("2026-07-26");
    const days = shapeUnclosedPriorDays({
      priorTeams: [{ id: "t1", work_date: since }],
      closedDates: [],
      attendance: [],
      today: "2026-07-26",
      since,
    });
    expect(days.map((d) => d.date)).toEqual([since]);
  });

  it("carryoverWindowStart counts back whole calendar days", () => {
    expect(CLOSE_CARRYOVER_WINDOW_DAYS).toBe(30);
    expect(carryoverWindowStart("2026-07-26")).toBe("2026-06-26");
    // Across a month boundary and a leap day — plain UTC-anchored arithmetic, so
    // no DST or timezone drift can shift it.
    expect(carryoverWindowStart("2026-03-02")).toBe("2026-01-31");
    expect(carryoverWindowStart("2024-03-02")).toBe("2024-02-01");
  });

  it("no prior teams → nothing to close", () => {
    expect(
      shapeUnclosedPriorDays({
        priorTeams: [],
        closedDates: [],
        attendance: [],
        today: "2026-07-26",
        since: "2026-06-26",
      }),
    ).toEqual([]);
  });
});
