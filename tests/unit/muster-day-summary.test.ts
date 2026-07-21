import { describe, expect, it } from "vitest";
import { summariseMusterDay } from "@/lib/muster/day-summary";

const closure = { closed_at: "2026-07-21T10:00:00Z" };

describe("summariseMusterDay", () => {
  it("no teams today → not_started, present 0", () => {
    const s = summariseMusterDay({
      teamCount: 0,
      attendanceWorkerIds: [],
      expected: 25,
      closure: null,
    });
    expect(s).toEqual({ state: "not_started", present: 0, expected: 25, closedAt: null });
  });
  it("teams open, no closure → open with distinct present", () => {
    const s = summariseMusterDay({
      teamCount: 2,
      attendanceWorkerIds: ["a", "b", "a"],
      expected: 25,
      closure: null,
    });
    expect(s.state).toBe("open");
    expect(s.present).toBe(2); // moved worker counted once
  });
  it("closure row → closed + closedAt, even with teams", () => {
    const s = summariseMusterDay({
      teamCount: 1,
      attendanceWorkerIds: ["a"],
      expected: 25,
      closure,
    });
    expect(s.state).toBe("closed");
    expect(s.closedAt).toBe(closure.closed_at);
  });
  it("closure wins over zero teams (closed empty day)", () => {
    expect(
      summariseMusterDay({ teamCount: 0, attendanceWorkerIds: [], expected: 25, closure }).state,
    ).toBe("closed");
  });
  it("present may exceed expected — spec: render truth, never clamp", () => {
    const s = summariseMusterDay({
      teamCount: 1,
      attendanceWorkerIds: ["a", "b", "c"],
      expected: 2,
      closure: null,
    });
    expect(s.present).toBe(3);
    expect(s.expected).toBe(2);
  });
  it("zero expected is representable (empty project)", () => {
    expect(
      summariseMusterDay({ teamCount: 0, attendanceWorkerIds: [], expected: 0, closure: null })
        .expected,
    ).toBe(0);
  });
});
