// Spec 374 U1 — buildAttendanceMonth: pure view-model for the per-worker
// attendance calendar. Muster rows (possibly two sessions per day) + labor_logs
// paid days + day_rate → month grid cells + summary. All display math here so
// the page stays a thin server component.
import { describe, expect, it } from "vitest";

import {
  buildAttendanceMonth,
  paidRowsFromLaborLogs,
  resolveMonthAnchor,
  type AttendanceMusterRow,
  type AttendancePaidRow,
} from "@/lib/attendance/attendance-month";

const muster = (over: Partial<AttendanceMusterRow>): AttendanceMusterRow => ({
  work_date: "2026-07-15",
  in_at: "2026-07-15T00:30:00Z", // 07:30 Bangkok
  out_at: "2026-07-15T10:00:00Z", // 17:00 Bangkok
  in_method: "qr",
  out_method: "manual",
  out_auto: false,
  ot_hours: 0,
  project_name: "TFM โพธิ์ทอง",
  ...over,
});

const paid = (over: Partial<AttendancePaidRow>): AttendancePaidRow => ({
  work_date: "2026-07-15",
  day_fraction: 1,
  ...over,
});

describe("buildAttendanceMonth", () => {
  it("empty month: full grid, no cells, zero summary, estimate 0", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [],
      paidRows: [],
      dayRate: 500,
    });
    expect(m.grid.weeks.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(m.cells)).toHaveLength(0);
    expect(m.summary.daysScanned).toBe(0);
    expect(m.summary.otHoursTotal).toBe(0);
    expect(m.summary.estimatedGross).toBe(0);
    expect(m.summary.paidDaysTotal).toBe(0);
    expect(m.summary.varianceDays).toBe(0);
  });

  it("formats in/out as Bangkok HH:mm and carries method + project", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({})],
      paidRows: [],
      dayRate: 500,
    });
    const cell = m.cells["2026-07-15"];
    expect(cell).toBeDefined();
    expect(cell?.inTime).toBe("07:30");
    expect(cell?.outTime).toBe("17:00");
    expect(cell?.inMethod).toBe("qr");
    expect(cell?.outAuto).toBe(false);
    expect(cell?.projectName).toBe("TFM โพธิ์ทอง");
    expect(m.summary.daysScanned).toBe(1);
    expect(m.summary.estimatedGross).toBe(500);
  });

  it("merges two sessions on one date: one day, earliest in, latest out, OT summed", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        muster({}),
        muster({
          in_at: "2026-07-15T11:00:00Z", // 18:00
          out_at: "2026-07-15T14:00:00Z", // 21:00
          ot_hours: 3,
        }),
      ],
      paidRows: [],
      dayRate: 400,
    });
    expect(m.summary.daysScanned).toBe(1);
    expect(m.summary.otHoursTotal).toBe(3);
    const cell = m.cells["2026-07-15"];
    expect(cell?.inTime).toBe("07:30");
    expect(cell?.outTime).toBe("21:00");
    expect(cell?.otHours).toBe(3);
    expect(m.summary.estimatedGross).toBe(400);
  });

  it("flags auto check-out on the cell", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({ out_auto: true })],
      paidRows: [],
      dayRate: null,
    });
    expect(m.cells["2026-07-15"]?.outAuto).toBe(true);
  });

  it("null day rate → estimate null, never NaN", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({})],
      paidRows: [],
      dayRate: null,
    });
    expect(m.summary.estimatedGross).toBeNull();
  });

  it("open day (no out yet) renders in time with out null", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({ out_at: null, out_method: null })],
      paidRows: [],
      dayRate: 500,
    });
    const cell = m.cells["2026-07-15"];
    expect(cell?.inTime).toBe("07:30");
    expect(cell?.outTime).toBeNull();
  });

  it("paid days sum day_fraction; variance = scanned − paid", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        muster({}),
        muster({
          work_date: "2026-07-16",
          in_at: "2026-07-16T00:30:00Z",
          out_at: "2026-07-16T10:00:00Z",
        }),
      ],
      paidRows: [paid({}), paid({ work_date: "2026-07-16", day_fraction: 0.5 })],
      dayRate: 500,
    });
    expect(m.summary.daysScanned).toBe(2);
    expect(m.summary.paidDaysTotal).toBe(1.5);
    expect(m.summary.varianceDays).toBe(0.5);
    expect(m.cells["2026-07-16"]?.paidFraction).toBe(0.5);
  });

  it("ignores rows outside the anchor month (defensive against loader over-fetch)", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({ work_date: "2026-06-30", in_at: "2026-06-30T00:30:00Z" })],
      paidRows: [paid({ work_date: "2026-08-01" })],
      dayRate: 500,
    });
    expect(m.summary.daysScanned).toBe(0);
    expect(m.summary.paidDaysTotal).toBe(0);
    expect(Object.keys(m.cells)).toHaveLength(0);
  });

  it("paidRowsFromLaborLogs mirrors payroll semantics: supersede anti-join + full/half map", () => {
    const rows = [
      // superseded by r3 → dropped (ADR 0009 anti-join, same as payroll currentRows)
      { id: "r1", superseded_by: null, work_date: "2026-07-15", day_fraction: "full" as const },
      // the superseding correction, half day
      { id: "r3", superseded_by: "r1", work_date: "2026-07-15", day_fraction: "half" as const },
      // cancellation row (null fraction) → dropped
      { id: "r2", superseded_by: null, work_date: "2026-07-16", day_fraction: null },
      { id: "r4", superseded_by: null, work_date: "2026-07-17", day_fraction: "full" as const },
    ];
    expect(paidRowsFromLaborLogs(rows)).toEqual([
      { work_date: "2026-07-15", day_fraction: 0.5 },
      { work_date: "2026-07-17", day_fraction: 1 },
    ]);
  });

  it("estimate multiplies DISTINCT scanned days, not session rows", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({}), muster({ ot_hours: 2 })],
      paidRows: [],
      dayRate: 300,
    });
    expect(m.summary.estimatedGross).toBe(300);
  });

  it("flags an out that lands past midnight Bangkok (OT crossing the date line)", () => {
    // 15T18:30Z = 01:30 Bangkok on the 16th — a 22:00→01:30 OT session must
    // not read as out-before-in on the work_date cell (the sibling drill
    // carries the same outNextDay flag for live data of this shape).
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({ in_at: "2026-07-15T15:00:00Z", out_at: "2026-07-15T18:30:00Z" })],
      paidRows: [],
      dayRate: null,
    });
    const cell = m.cells["2026-07-15"];
    expect(cell?.outTime).toBe("01:30");
    expect(cell?.outNextDay).toBe(true);
  });

  it("same-day out is not flagged as next-day", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [muster({})],
      paidRows: [],
      dayRate: null,
    });
    expect(m.cells["2026-07-15"]?.outNextDay).toBe(false);
  });

  it("maps holidays by date, filtered to the anchor month (spec 374 U2)", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
      holidays: [
        { holiday_date: "2026-07-28", name_th: "วันเฉลิมพระชนมพรรษา" },
        { holiday_date: "2026-08-12", name_th: "วันแม่แห่งชาติ" },
      ],
    });
    expect(m.holidayByDate["2026-07-28"]).toBe("วันเฉลิมพระชนมพรรษา");
    expect(m.holidayByDate["2026-08-12"]).toBeUndefined();
  });

  it("holidays default to an empty map when absent", () => {
    const m = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
    });
    expect(m.holidayByDate).toEqual({});
  });
});

describe("resolveMonthAnchor", () => {
  const today = "2026-07-29";

  it("accepts a valid YYYY-MM and anchors to day 1", () => {
    expect(resolveMonthAnchor("2026-03", today)).toBe("2026-03-01");
  });

  it("falls back to the current Bangkok month when absent or malformed", () => {
    expect(resolveMonthAnchor(undefined, today)).toBe("2026-07-01");
    expect(resolveMonthAnchor("garbage", today)).toBe("2026-07-01");
    expect(resolveMonthAnchor("2026-13", today)).toBe("2026-07-01");
  });

  it("rejects out-of-range years (no 22007 from the DB, no 1900s grid)", () => {
    expect(resolveMonthAnchor("9999-12", today)).toBe("2026-07-01");
    expect(resolveMonthAnchor("0000-01", today)).toBe("2026-07-01");
  });

  it("takes the first value of a repeated param", () => {
    expect(resolveMonthAnchor(["2026-06", "2026-08"], today)).toBe("2026-06-01");
  });
});
