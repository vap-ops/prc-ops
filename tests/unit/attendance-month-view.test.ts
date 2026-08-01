// Spec 388 U4 — the ช่าง's attendance as a MONTH GRID.
//
// Why a grid replaced the U2 list: live density is 1.43 sessions per worked day
// (OT is not rare — 59 of 195 rows), so a steady month is ~37 rows per ช่าง ≈
// 5–6 phone screens of cards. That is the same infinite-scroll shape spec 384
// had to undo on the SA home. A month compresses to one screen.
//
// ⚠️ What this builder must NOT do is what spec 374's buildAttendanceMonth does:
// merge a day's sessions into a single cell. That silently drops the ตรงเวลา/สาย
// verdict and the OT split — and 41% of rows are OT. So the day state keeps the
// SESSIONS, and derives only the two flags the grid paints with.

import { describe, expect, it } from "vitest";
import {
  buildAttendanceMonthView,
  type AttendanceSessionInput,
} from "@/lib/attendance/attendance-sessions";

function row(over: Partial<AttendanceSessionInput> = {}): AttendanceSessionInput {
  return {
    work_date: "2026-07-15",
    session: "regular",
    in_at: "2026-07-15T01:00:00+00:00", // 08:00 Bangkok
    in_method: "qr",
    out_at: "2026-07-15T10:00:00+00:00", // 17:00 Bangkok
    out_method: "qr",
    out_auto: false,
    ot_hours: 0,
    project_name: "TFM นายาว เพชรบูรณ์",
    ...over,
  };
}

const JULY = "2026-07-01";

describe("buildAttendanceMonthView — the grid", () => {
  it("covers the anchor month in Sunday-first weeks with a BE label", () => {
    const v = buildAttendanceMonthView({ rows: [], monthAnchor: JULY });
    expect(v.grid.label).toContain("2569"); // Buddhist era
    expect(v.grid.weeks.length).toBeGreaterThanOrEqual(4);
    expect(v.grid.weeks[0]).toHaveLength(7);
  });

  it("keeps only the anchor month's rows — a neighbouring month cannot bleed in", () => {
    const v = buildAttendanceMonthView({
      rows: [row({ work_date: "2026-07-15" }), row({ work_date: "2026-06-30" })],
      monthAnchor: JULY,
    });
    expect(Object.keys(v.days)).toEqual(["2026-07-15"]);
  });
});

describe("buildAttendanceMonthView — the day state the grid paints with", () => {
  it("keeps a day's sessions rather than merging them (spec 374's cell would not)", () => {
    const v = buildAttendanceMonthView({
      rows: [row(), row({ session: "ot", in_at: "2026-07-15T10:25:00+00:00", ot_hours: 3 })],
      monthAnchor: JULY,
    });
    const day = v.days["2026-07-15"];
    expect(day?.sessions).toHaveLength(2);
    expect(day?.hasOt).toBe(true);
  });

  it("flags a day late when its regular QR session was late", () => {
    const v = buildAttendanceMonthView({
      rows: [row({ in_at: "2026-07-15T01:31:00+00:00" })], // 08:31 Bangkok
      monthAnchor: JULY,
    });
    expect(v.days["2026-07-15"]?.late).toBe(true);
  });

  it("does NOT flag a day late off a manual row — the SA's tap is not the arrival", () => {
    const v = buildAttendanceMonthView({
      rows: [row({ in_at: "2026-07-15T01:31:00+00:00", in_method: "manual" })],
      monthAnchor: JULY,
    });
    expect(v.days["2026-07-15"]?.late).toBe(false);
  });

  it("does NOT flag a day late off an OT session — there is no OT start rule", () => {
    const v = buildAttendanceMonthView({
      rows: [row({ session: "ot", in_at: "2026-07-15T13:00:00+00:00", ot_hours: 2 })],
      monthAnchor: JULY,
    });
    expect(v.days["2026-07-15"]?.late).toBe(false);
    expect(v.days["2026-07-15"]?.hasOt).toBe(true);
  });

  it("a day with no rows has no entry at all (the grid paints it blank)", () => {
    const v = buildAttendanceMonthView({ rows: [row()], monthAnchor: JULY });
    expect(v.days["2026-07-16"]).toBeUndefined();
  });
});

describe("buildAttendanceMonthView — the month summary", () => {
  it("counts distinct worked days, verdicts and OT sessions within the month", () => {
    const v = buildAttendanceMonthView({
      rows: [
        row({ work_date: "2026-07-15", in_at: "2026-07-15T01:05:00+00:00" }), // on time
        row({ work_date: "2026-07-16", in_at: "2026-07-16T01:31:00+00:00" }), // late
        row({ work_date: "2026-07-16", session: "ot", ot_hours: 3 }), // same DAY
        row({ work_date: "2026-08-03" }), // another month entirely
      ],
      monthAnchor: JULY,
    });
    expect(v.summary).toEqual({
      daysRecorded: 2,
      onTime: 1,
      late: 1,
      otSessions: 1,
      otHoursTotal: 3,
    });
  });
});
