// Spec 388 U2 — the ช่าง's own attendance list: one row per SESSION (not per
// day), plus the late verdict.
//
// Why this is not buildAttendanceMonth: that builder MERGES a date's sessions
// into one cell (earliest in, latest out, OT summed) because the procurement
// calendar renders one cell per date. This surface must keep regular and OT
// apart — the verdict applies to the regular session only — so collapsing them
// is exactly the wrong shape here. The two share the row type and the Bangkok
// formatter; the grain differs.
//
// The unit under test is minutes-of-day in Asia/Bangkok. Every timestamp below
// is written in UTC with its Bangkok wall clock named in the comment, because
// getting that conversion wrong is the whole failure mode: Bangkok is UTC+7, so
// 08:15 local is 01:15Z.

import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_WINDOW_DAYS,
  LATE_CUTOFF_MINUTES,
  buildAttendanceSessions,
  type AttendanceSessionInput,
} from "@/lib/attendance/attendance-sessions";

const TODAY = "2026-08-01";

function row(over: Partial<AttendanceSessionInput> = {}): AttendanceSessionInput {
  return {
    work_date: "2026-07-31",
    session: "regular",
    in_at: "2026-07-31T01:00:00+00:00", // 08:00 Bangkok
    in_method: "qr",
    out_at: "2026-07-31T10:00:00+00:00", // 17:00 Bangkok
    out_method: "qr",
    out_auto: false,
    ot_hours: 0,
    project_name: "TFM นายาว เพชรบูรณ์",
    ...over,
  };
}

describe("the late cutoff (08:00 start + 15 min grace)", () => {
  it("is 08:15 expressed as Bangkok minutes-of-day", () => {
    expect(LATE_CUTOFF_MINUTES).toBe(8 * 60 + 15);
  });

  it("calls 08:14:59 Bangkok on time — the last second before the line", () => {
    const [r] = buildAttendanceSessions({
      rows: [row({ in_at: "2026-07-31T01:14:59+00:00" })],
      todayIso: TODAY,
    }).rows;
    expect(r?.verdict).toBe("on_time");
  });

  it("calls 08:15:00 Bangkok late — the first second on the line", () => {
    const [r] = buildAttendanceSessions({
      rows: [row({ in_at: "2026-07-31T01:15:00+00:00" })],
      todayIso: TODAY,
    }).rows;
    expect(r?.verdict).toBe("late");
  });

  it("reads the wall clock in Bangkok, not UTC — 08:05 local is 01:05Z and on time", () => {
    // The bug this pins: treating 01:05Z as 01:05 local would call it on time
    // for the wrong reason, and 20:00Z (03:00 next-day Bangkok) would flip.
    const [r] = buildAttendanceSessions({
      rows: [row({ in_at: "2026-07-31T01:05:00+00:00" })],
      todayIso: TODAY,
    }).rows;
    expect(r?.inTime).toBe("08:05");
    expect(r?.verdict).toBe("on_time");
  });
});

describe("who gets a verdict at all", () => {
  it("gives a MANUAL check-in no verdict — the time is the SA's tap, not the arrival", () => {
    const [r] = buildAttendanceSessions({
      // 08:31 Bangkok: unambiguously past the cutoff, so only the method can be
      // suppressing the verdict.
      rows: [row({ in_at: "2026-07-31T01:31:00+00:00", in_method: "manual" })],
      todayIso: TODAY,
    }).rows;
    expect(r?.verdict).toBe("none");
  });

  it("gives an OT session no verdict — there is no OT start rule to be late against", () => {
    const [r] = buildAttendanceSessions({
      rows: [row({ session: "ot", in_at: "2026-07-31T10:25:00+00:00", ot_hours: 3 })],
      todayIso: TODAY,
    }).rows;
    expect(r?.verdict).toBe("none");
    expect(r?.otHours).toBe(3);
  });

  it("gives a row with no in_at no verdict", () => {
    const [r] = buildAttendanceSessions({
      rows: [row({ in_at: null })],
      todayIso: TODAY,
    }).rows;
    expect(r?.verdict).toBe("none");
    expect(r?.inTime).toBeNull();
  });
});

describe("the rendered row", () => {
  it("keeps an open day open rather than inventing a departure", () => {
    const [r] = buildAttendanceSessions({
      rows: [row({ out_at: null, out_method: null })],
      todayIso: TODAY,
    }).rows;
    expect(r?.outTime).toBeNull();
    expect(r?.outAuto).toBe(false);
  });

  it("flags an auto-closed check-out (it is not a recorded departure)", () => {
    const [r] = buildAttendanceSessions({
      rows: [row({ out_auto: true })],
      todayIso: TODAY,
    }).rows;
    expect(r?.outAuto).toBe(true);
  });

  it("marks a post-midnight OT check-out as next-day so it cannot read as out-before-in", () => {
    const [r] = buildAttendanceSessions({
      rows: [
        row({
          session: "ot",
          in_at: "2026-07-31T13:00:00+00:00", // 20:00 Bangkok, same day
          out_at: "2026-07-31T18:30:00+00:00", // 01:30 Bangkok on 08-01
        }),
      ],
      todayIso: TODAY,
    }).rows;
    expect(r?.outNextDay).toBe(true);
  });
});

describe("the window and the order", () => {
  it(`keeps the last ${ATTENDANCE_WINDOW_DAYS} days and drops what is older`, () => {
    const built = buildAttendanceSessions({
      rows: [
        row({ work_date: "2026-07-31" }),
        row({ work_date: "2026-07-03" }), // 29 days back — inside
        row({ work_date: "2026-07-02" }), // 30 days back — inside (inclusive)
        row({ work_date: "2026-06-25" }), // 37 days back — outside
      ],
      todayIso: TODAY,
    });
    expect(built.rows.map((r) => r.workDate)).toEqual(["2026-07-31", "2026-07-03", "2026-07-02"]);
  });

  it("preserves the RPC's order rather than re-sorting it", () => {
    // The RPC emits work_date DESC, in_at ASC — days newest first, but a day's
    // sessions in the order they happened. Re-sorting here would silently
    // undo that decision.
    const built = buildAttendanceSessions({
      rows: [
        row({ work_date: "2026-07-31", in_at: "2026-07-31T01:00:00+00:00" }),
        row({ work_date: "2026-07-30", in_at: "2026-07-30T01:03:00+00:00" }),
        row({
          work_date: "2026-07-30",
          session: "ot",
          in_at: "2026-07-30T10:25:00+00:00",
          ot_hours: 3,
        }),
      ],
      todayIso: TODAY,
    });
    expect(built.rows.map((r) => `${r.workDate}/${r.session}`)).toEqual([
      "2026-07-31/regular",
      "2026-07-30/regular",
      "2026-07-30/ot",
    ]);
  });
});

describe("the summary", () => {
  it("counts distinct days, verdicts and OT sessions over the window", () => {
    const built = buildAttendanceSessions({
      rows: [
        row({ work_date: "2026-08-01", in_at: "2026-08-01T01:05:00+00:00" }), // on time
        row({ work_date: "2026-07-31", in_at: "2026-07-31T01:31:00+00:00" }), // late
        row({ work_date: "2026-07-30", in_at: "2026-07-30T01:03:00+00:00", in_method: "manual" }),
        row({ work_date: "2026-07-30", session: "ot", ot_hours: 3 }), // same DAY as above
        row({ work_date: "2026-06-01" }), // outside the window entirely
      ],
      todayIso: TODAY,
    });
    expect(built.summary).toEqual({
      daysRecorded: 3, // 08-01, 07-31, 07-30 — the OT row shares 07-30
      onTime: 1,
      late: 1,
      otSessions: 1,
      otHoursTotal: 3,
    });
  });

  it("is all zeroes for a ช่าง with no rows", () => {
    const built = buildAttendanceSessions({ rows: [], todayIso: TODAY });
    expect(built.rows).toEqual([]);
    expect(built.summary).toEqual({
      daysRecorded: 0,
      onTime: 0,
      late: 0,
      otSessions: 0,
      otHoursTotal: 0,
    });
  });
});
