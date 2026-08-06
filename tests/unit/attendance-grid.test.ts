// Spec 400 U1 — the pure builder behind the attendance GRID.
//
// The rules under test are the ones the spec calls load-bearing, and each of
// them is a defect the list view already shipped or narrowly avoided:
//   · a date's regular + OT sessions MERGE into one cell (spec 351 grain), with
//     the same earliest-in / latest-out / OT-summed rule buildAttendanceMonth
//     uses — pinned by a parity test, not by a comment;
//   · headcount and closure are PROJECT-DAY facts and live on the column, never
//     on a worker cell (the spec-358 U2 correction, which costs 41× more here);
//   · Sundays and public_holidays are NON-WORKING, so an empty column there is
//     not a finding — without this the grid cries wolf every week.

import { describe, expect, it } from "vitest";
import {
  MAX_GRID_DAYS,
  buildAttendanceGrid,
  type AttendanceGridInput,
} from "@/lib/muster/attendance-grid";
import { buildAttendanceMonth } from "@/lib/attendance/attendance-month";
import type { AttendanceDetailRow } from "@/lib/muster/attendance-audit";

/** A detail row as `audit_attendance_detail` + shapeDetailRow produce one. */
function row(over: Partial<AttendanceDetailRow> = {}): AttendanceDetailRow {
  const workDate = over.workDate ?? "2026-08-03";
  return {
    workerId: "w1",
    workerName: "สมชาย",
    projectId: "p1",
    projectName: "TFM โพธิ์ทอง",
    workDate,
    session: "regular",
    inAt: `${workDate}T01:00:00+00:00`,
    inTime: "08:00",
    inMethod: "qr",
    outAt: `${workDate}T10:00:00+00:00`,
    outTime: "17:00",
    outMethod: "qr",
    outAuto: false,
    otHours: null,
    scannedBy: "u1",
    scannedByName: "อรปรีญา",
    teamLeadName: "หัวหน้า",
    dayClosed: false,
    stillIn: false,
    outNextDay: false,
    ...over,
  };
}

function build(over: Partial<AttendanceGridInput> = {}) {
  return buildAttendanceGrid({
    from: "2026-08-03",
    to: "2026-08-05",
    rows: [],
    holidays: [],
    todayIso: "2026-08-05",
    ...over,
  });
}

describe("buildAttendanceGrid — columns", () => {
  it("emits one column per date in the range, inclusive of both ends", () => {
    const grid = build();
    expect(grid.days.map((d) => d.date)).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
  });

  it("refuses a range wider than the cap instead of rendering thousands of columns", () => {
    // ?start is user-supplied and validated for SHAPE only, so an 1900 date is
    // reachable. Generating a column per day would hang the render; the view
    // shows the refusal and keeps the list one tap away.
    const grid = build({ from: "2020-01-01", to: "2026-08-05" });
    expect(grid.tooWide).toBe(true);
    expect(grid.days).toEqual([]);
    expect(MAX_GRID_DAYS).toBeGreaterThan(31);
  });

  it("marks Sundays and public holidays as non-working, and names the holiday", () => {
    // 2026-08-02 is a Sunday; 2026-08-04 is seeded here as a holiday.
    const grid = build({
      from: "2026-08-02",
      to: "2026-08-04",
      holidays: [{ holiday_date: "2026-08-04", name_th: "วันหยุดทดสอบ" }],
    });
    const [sunday, monday, holiday] = grid.days;
    expect(sunday?.nonWorking).toBe(true);
    expect(sunday?.holidayName).toBeNull();
    expect(monday?.nonWorking).toBe(false);
    expect(holiday?.nonWorking).toBe(true);
    expect(holiday?.holidayName).toBe("วันหยุดทดสอบ");
  });

  it("counts headcount per day as DISTINCT workers, not sessions", () => {
    const grid = build({
      rows: [
        row({ workerId: "a", workDate: "2026-08-03" }),
        row({ workerId: "a", workDate: "2026-08-03", session: "ot", otHours: 2 }),
        row({ workerId: "b", workDate: "2026-08-03" }),
        row({ workerId: "a", workDate: "2026-08-04" }),
      ],
    });
    expect(grid.days.map((d) => d.headcount)).toEqual([2, 1, 0]);
  });

  it("carries closure on the DAY, and leaves a day with no rows unknown", () => {
    const grid = build({
      rows: [
        row({ workerId: "a", workDate: "2026-08-03", dayClosed: true }),
        row({ workerId: "b", workDate: "2026-08-03", dayClosed: true }),
        row({ workerId: "a", workDate: "2026-08-04", dayClosed: false }),
      ],
    });
    expect(grid.days.map((d) => d.dayClosed)).toEqual([true, false, null]);
  });

  it("resolves closure with EVERY, so one open session leaves the day open", () => {
    // Mirrors groupDetailByDate's reducer: closure is one project-day fact, and
    // `every` fails CLOSED if that invariant ever breaks — the safe direction
    // for a "this day is settled" claim.
    const grid = build({
      rows: [
        row({ workerId: "a", workDate: "2026-08-03", dayClosed: true }),
        row({ workerId: "b", workDate: "2026-08-03", dayClosed: false }),
      ],
    });
    expect(grid.days[0]?.dayClosed).toBe(false);
  });
});

describe("buildAttendanceGrid — cells", () => {
  it("merges a date's regular and OT sessions into ONE cell", () => {
    const grid = build({
      rows: [
        row({
          workDate: "2026-08-03",
          session: "regular",
          inAt: "2026-08-03T01:00:00+00:00",
          inTime: "08:00",
          outAt: "2026-08-03T10:00:00+00:00",
          outTime: "17:00",
        }),
        row({
          workDate: "2026-08-03",
          session: "ot",
          inAt: "2026-08-03T10:30:00+00:00",
          inTime: "17:30",
          outAt: "2026-08-03T13:00:00+00:00",
          outTime: "20:00",
          otHours: 2.5,
        }),
      ],
    });
    const cell = grid.rows[0]?.cells["2026-08-03"];
    expect(cell?.inTime).toBe("08:00");
    expect(cell?.outTime).toBe("20:00");
    expect(cell?.otHours).toBe(2.5);
  });

  it("takes the EARLIEST in and the LATEST out regardless of row order", () => {
    const grid = build({
      rows: [
        row({
          session: "ot",
          inAt: "2026-08-03T10:30:00+00:00",
          inTime: "17:30",
          outAt: "2026-08-03T13:00:00+00:00",
          outTime: "20:00",
          otHours: 2,
        }),
        row({
          session: "regular",
          inAt: "2026-08-03T01:00:00+00:00",
          inTime: "08:00",
          outAt: "2026-08-03T10:00:00+00:00",
          outTime: "17:00",
        }),
      ],
    });
    const cell = grid.rows[0]?.cells["2026-08-03"];
    expect(cell?.inTime).toBe("08:00");
    expect(cell?.outTime).toBe("20:00");
  });

  it("flags a manual check-in, an auto check-out and a post-midnight check-out", () => {
    const grid = build({
      rows: [row({ inMethod: "manual", outAuto: true, outNextDay: true })],
    });
    const cell = grid.rows[0]?.cells["2026-08-03"];
    expect(cell?.manualIn).toBe(true);
    expect(cell?.autoOut).toBe(true);
    expect(cell?.outNextDay).toBe(true);
  });

  it("flags openOut when ANY session of the date was never checked out", () => {
    // The regular session closed cleanly and the OT one did not. Reading only
    // the merged latest-out would call this cell complete and hide the gap that
    // 34% of August sessions actually carry.
    const grid = build({
      rows: [
        row({ session: "regular", outAt: "2026-08-03T10:00:00+00:00", outTime: "17:00" }),
        row({ session: "ot", outAt: null, outTime: null, stillIn: true, otHours: 1 }),
      ],
    });
    expect(grid.rows[0]?.cells["2026-08-03"]?.openOut).toBe(true);
  });

  it("gives a worker no cell on a date they were never scanned", () => {
    const grid = build({ rows: [row({ workDate: "2026-08-03" })] });
    const cells = grid.rows[0]?.cells;
    expect(cells?.["2026-08-03"]).toBeDefined();
    expect(cells?.["2026-08-04"]).toBeUndefined();
  });

  it("drops rows outside the range rather than inventing a column for them", () => {
    const grid = build({ rows: [row({ workDate: "2026-07-30" })] });
    expect(grid.rows).toEqual([]);
  });
});

describe("buildAttendanceGrid — rows", () => {
  it("orders workers by name and totals their days and OT", () => {
    const grid = build({
      rows: [
        row({ workerId: "b", workerName: "สมหญิง", workDate: "2026-08-03" }),
        row({ workerId: "a", workerName: "ก้อง", workDate: "2026-08-03" }),
        row({ workerId: "a", workerName: "ก้อง", workDate: "2026-08-04", otHours: 3 }),
        row({
          workerId: "a",
          workerName: "ก้อง",
          workDate: "2026-08-04",
          session: "ot",
          otHours: 3,
        }),
      ],
    });
    expect(grid.rows.map((r) => r.workerName)).toEqual(["ก้อง", "สมหญิง"]);
    expect(grid.rows[0]?.daysPresent).toBe(2);
    // 3 + 3 across the two sessions of 08-04; the regular row carries none in life
    // but the builder must not silently drop a value it was handed.
    expect(grid.rows[0]?.otHoursTotal).toBe(6);
    expect(grid.rows[1]?.daysPresent).toBe(1);
  });
});

describe("parity with the per-worker calendar (spec 374)", () => {
  it("merges a date exactly as buildAttendanceMonth does", () => {
    // The two builders exist for different surfaces and cannot share a function
    // (buildAttendanceMonth is month-anchored and labor_logs-coupled), so the
    // shared RULE is pinned here instead of asserted in a comment. If either
    // side changes its merge, this reds.
    const sessions = [
      {
        work_date: "2026-08-03",
        in_at: "2026-08-03T01:00:00+00:00",
        out_at: "2026-08-03T10:00:00+00:00",
        in_method: "qr",
        out_method: "qr",
        out_auto: false,
        ot_hours: 0,
        project_name: "TFM โพธิ์ทอง",
      },
      {
        work_date: "2026-08-03",
        in_at: "2026-08-03T10:30:00+00:00",
        out_at: "2026-08-04T01:00:00+00:00",
        in_method: "qr",
        out_method: "manual",
        out_auto: true,
        ot_hours: 4,
        project_name: "TFM โพธิ์ทอง",
      },
    ];
    const month = buildAttendanceMonth({
      monthAnchor: "2026-08-01",
      musterRows: sessions,
      paidRows: [],
      dayRate: null,
    });
    const grid = build({
      rows: sessions.map((s, i) =>
        row({
          workDate: s.work_date,
          session: i === 0 ? "regular" : "ot",
          inAt: s.in_at,
          inTime: i === 0 ? "08:00" : "17:30",
          outAt: s.out_at,
          outTime: i === 0 ? "17:00" : "08:00",
          outMethod: s.out_method as "qr" | "manual",
          outAuto: s.out_auto,
          otHours: s.ot_hours,
          outNextDay: i === 1,
        }),
      ),
    });

    const monthCell = month.cells["2026-08-03"];
    const gridCell = grid.rows[0]?.cells["2026-08-03"];
    expect(gridCell?.inTime).toBe(monthCell?.inTime);
    expect(gridCell?.outTime).toBe(monthCell?.outTime);
    expect(gridCell?.otHours).toBe(monthCell?.otHours);
    expect(gridCell?.outNextDay).toBe(monthCell?.outNextDay);
    expect(gridCell?.autoOut).toBe(monthCell?.outAuto);
  });
});
