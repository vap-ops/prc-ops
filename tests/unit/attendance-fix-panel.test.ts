// Spec 404 U2 — the calendar's in-page `?fix=` panel: its three pure decisions.
//
// Writing failing test first.
//
// PURE and exported for the reason U1 of spec 400 recorded: a source scan proves
// a branch EXISTS, never that it is REACHABLE, and the page that hosts these is a
// Server Component vitest cannot render. So every arm that decides whether the
// panel opens, which project it acts on, and where the day steppers go is driven
// directly here rather than inferred from the page's JSX.

import { describe, expect, it } from "vitest";

import { calendarFixTarget, fixPanelProjectId, fixStepDates } from "@/lib/attendance/fix-panel";

describe("calendarFixTarget — should the panel open at all (spec 404 U2)", () => {
  const anchor = "2026-07-01";

  it("is CLOSED with no reason when there is no ?fix= at all", () => {
    // Default closed. Opening with a panel already showing forces a default
    // target, and "today" is not in the viewed month half the time — the U6a
    // rule that no field ever carries a guessed default, applied to a surface.
    expect(calendarFixTarget(undefined, anchor)).toEqual({ open: false, reason: null });
  });

  it("opens on a valid date inside the viewed month", () => {
    expect(calendarFixTarget("2026-07-15", anchor)).toEqual({ open: true, date: "2026-07-15" });
  });

  it("refuses a date outside the viewed month, and says which fact is wrong", () => {
    // §6 case 1. The panel is docked beside THIS month's grid; a date from
    // another month would render a panel about a day that is not on screen —
    // the same defect `attendanceDayParam` closes for the grid's ?day=.
    expect(calendarFixTarget("2026-08-01", anchor)).toEqual({ open: false, reason: "outside" });
    expect(calendarFixTarget("2026-06-30", anchor)).toEqual({ open: false, reason: "outside" });
  });

  it("refuses a malformed date rather than guessing one", () => {
    // §6 case 2 — permanent for that URL, so the notice may never say ลองใหม่.
    expect(calendarFixTarget("2026-07-99", anchor)).toEqual({ open: false, reason: "shape" });
    expect(calendarFixTarget("tomorrow", anchor)).toEqual({ open: false, reason: "shape" });
    expect(calendarFixTarget("", anchor)).toEqual({ open: false, reason: "shape" });
  });

  it("treats a REPEATED ?fix= as malformed, never picking one silently", () => {
    // The spec-337 repeated-key rule, the same one parseFixParams' own `one()`
    // applies: ?fix=a&fix=b arrives as string[] and picking either invents an
    // intent the reader never expressed.
    expect(calendarFixTarget(["2026-07-15", "2026-07-16"], anchor)).toEqual({
      open: false,
      reason: "shape",
    });
  });

  it("accepts the month's first and last day (the boundary is inclusive)", () => {
    expect(calendarFixTarget("2026-07-01", anchor)).toEqual({ open: true, date: "2026-07-01" });
    expect(calendarFixTarget("2026-07-31", anchor)).toEqual({ open: true, date: "2026-07-31" });
  });
});

describe("fixPanelProjectId — which project the panel acts on (spec 404 U2)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("uses the DAY's own project whenever the day carries attendance", () => {
    // The day owns the project (§2). Nothing else may override it — a month-level
    // guess on a day that already states its own owner is the U1 badge defect
    // running one level down.
    expect(fixPanelProjectId({ cellProjectId: A, monthProjectIds: [A, B] })).toBe(A);
  });

  it("falls back to the month's project when the day is EMPTY and the month has one", () => {
    // What the calendar can do that the standalone fix screen structurally
    // cannot (§4.3): with no session there is nothing to infer a project FROM,
    // and this surface knows the month's project set.
    expect(fixPanelProjectId({ cellProjectId: null, monthProjectIds: [A] })).toBe(A);
  });

  it("refuses to guess on an empty day of a SPLIT month", () => {
    // Two owners and no evidence. Adding a missed person to the wrong project
    // books their wage against it — inventing an owner is exactly what
    // `projectDays` refuses to do at the summary level.
    expect(fixPanelProjectId({ cellProjectId: null, monthProjectIds: [A, B] })).toBeNull();
  });

  it("is null when the month carries no project at all", () => {
    // §6 case 3 — the panel opens and states the permanent refusal.
    expect(fixPanelProjectId({ cellProjectId: null, monthProjectIds: [] })).toBeNull();
  });
});

describe("fixStepDates — วันก่อนหน้า / วันถัดไป (spec 404 U2)", () => {
  // The days a cell actually opens: stepping has to land on a day the reader
  // could have tapped, or the two controls disagree about what this month holds.
  const doors = ["2026-07-03", "2026-07-15", "2026-07-16", "2026-07-29"];

  it("steps to the neighbouring day that CARRIES attendance, skipping the blanks", () => {
    // §4.3 — walking through 20 empty cells is the cry-wolf failure U6b already
    // ruled against. 07-15 → 07-16 is adjacent; 07-16 → 07-29 skips twelve.
    expect(fixStepDates(doors, "2026-07-15")).toEqual({
      prev: "2026-07-03",
      next: "2026-07-16",
    });
    expect(fixStepDates(doors, "2026-07-16")).toEqual({
      prev: "2026-07-15",
      next: "2026-07-29",
    });
  });

  it("has no previous at the first door and no next at the last", () => {
    expect(fixStepDates(doors, "2026-07-03")).toEqual({ prev: null, next: "2026-07-15" });
    expect(fixStepDates(doors, "2026-07-29")).toEqual({ prev: "2026-07-16", next: null });
  });

  it("steps from a date that is NOT itself a door, by position in the month", () => {
    // An empty day is still openable by tapping its cell, and once open it needs
    // the same two controls: the neighbours are the doors on either side of it.
    expect(fixStepDates(doors, "2026-07-20")).toEqual({
      prev: "2026-07-16",
      next: "2026-07-29",
    });
  });

  it("offers nothing at all when the month has no doors", () => {
    expect(fixStepDates([], "2026-07-15")).toEqual({ prev: null, next: null });
  });

  it("does not depend on the caller having sorted the doors", () => {
    // The cells come out of a Record, whose key order is an implementation
    // detail — a stepper that inherited it would walk the month at random.
    expect(fixStepDates(["2026-07-29", "2026-07-03", "2026-07-16", "2026-07-15"], "2026-07-16")) //
      .toEqual({ prev: "2026-07-15", next: "2026-07-29" });
  });
});
