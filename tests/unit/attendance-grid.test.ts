// Spec 400 U1 — the pure builder behind the attendance GRID.
//
// The rules under test are the ones the spec calls load-bearing, and each of
// them is a defect the list view already shipped or narrowly avoided:
//   · a date's regular + OT sessions MERGE into one cell (spec 351 grain), with
//     the same earliest-in / latest-out / OT-summed rule buildAttendanceMonth
//     uses — pinned by a parity test, not by a comment;
//   · headcount and closure are PROJECT-DAY facts and live on the column, never
//     on a worker cell (the spec-358 U2 correction, which costs 41× more here);
//   · Sundays are NON-WORKING, so an empty column there is not a finding —
//     without this the grid cries wolf every week. (Public holidays were the
//     other half of that rule until the operator withdrew the holiday model on
//     2026-08-08; a holiday is an ordinary working day here.)

import { describe, expect, it } from "vitest";
import {
  MAX_GRID_DAYS,
  attendanceView,
  buildAttendanceGrid,
  gridWorkerHref,
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

  it("marks SUNDAY as non-working — and a public holiday as an ordinary day", () => {
    // Operator 2026-08-08: "hide info about holidays, we do not have those yet.
    // money is the same as normal day." 2026-08-02 is a Sunday; 2026-08-12 is
    // วันแม่แห่งชาติ in the (retained, now unread) `public_holidays` seed and is
    // an ordinary Wednesday to this site. Sunday keeps the shading because the
    // site genuinely does not muster then.
    const grid = build({ from: "2026-08-02", to: "2026-08-03" });
    const [sunday, monday] = grid.days;
    expect(sunday?.nonWorking).toBe(true);
    expect(monday?.nonWorking).toBe(false);
    const august = build({ from: "2026-08-11", to: "2026-08-13" });
    expect(august.days.map((d) => d.nonWorking)).toEqual([false, false, false]);
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

  it("flags manualIn and autoOut on the SAME any-session rule as openOut", () => {
    // A review caught these two being read off the earliest-in / latest-out
    // session while openOut looked at all of them — so a QR regular check-in
    // hid a typed OT one, and a hand check-out hid an auto-closed session. The
    // argument that produced openOut applies verbatim; the cell displays the
    // regular session's times and must still carry both findings.
    const grid = build({
      rows: [
        row({
          session: "regular",
          inMethod: "qr",
          outAuto: false,
          outAt: "2026-08-03T10:00:00+00:00",
          outTime: "17:00",
        }),
        row({
          session: "ot",
          inMethod: "manual",
          outAuto: true,
          inAt: "2026-08-03T10:30:00+00:00",
          inTime: "17:30",
          outAt: "2026-08-03T09:00:00+00:00", // earlier instant ⇒ not the latest
          outTime: "16:00",
        }),
      ],
    });
    const cell = grid.rows[0]?.cells["2026-08-03"];
    expect(cell?.inTime).toBe("08:00"); // the QR session is the one displayed
    expect(cell?.outTime).toBe("17:00"); // …and the hand check-out
    expect(cell?.manualIn).toBe(true);
    expect(cell?.autoOut).toBe(true);
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

describe("gridWorkerHref — the link goes where the ROLE can land", () => {
  const range = { from: "2026-08-01", to: "2026-08-05" };

  it("sends a roster role to the spec-374 calendar, ANCHORED on the audited month", () => {
    // Without `m=`, that calendar falls back to the CURRENT month — so a checker
    // auditing July would click a name and land on August, the range they were
    // reading silently discarded at the click. A review caught it.
    const href = gridWorkerHref({
      workerId: "w1",
      canOpenCalendar: true,
      range: { from: "2026-07-24", to: "2026-07-31" },
      backHref: "/team",
    });
    expect(href).toContain("/workers/w1/attendance?");
    expect(href).toContain("m=2026-07");
  });

  it("threads the report's own range back, so the calendar's back chip returns there", () => {
    const href = gridWorkerHref({
      workerId: "w1",
      canOpenCalendar: true,
      range: { from: "2026-07-24", to: "2026-07-31", projectId: "p1" },
      backHref: "/procurement",
    });
    const back = new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("from") ?? "";
    expect(back).toContain("start=2026-07-24");
    expect(back).toContain("end=2026-07-31");
    expect(back).toContain("project=p1");
    // …including the referrer, or a procurement reader cannot get home.
    expect(back).toContain("from=%2Fprocurement");
  });

  it("sends a NON-roster audit role to this report's own drill instead", () => {
    // accounting / hr / project_coordinator are in ATTENDANCE_AUDIT_ROLES but not
    // in WORKER_ROSTER_ROLES, so the calendar would redirect them. The affordance
    // is re-aimed, never withheld — and this arm was mutation-proved reachable.
    const href = gridWorkerHref({
      workerId: "w1",
      canOpenCalendar: false,
      range,
      backHref: "/team",
    });
    expect(href).toContain("/team/attendance?");
    expect(href).toContain("view=list");
    expect(href).toContain("worker=w1");
    expect(href).toContain("start=2026-08-01");
    expect(href).toContain("end=2026-08-05");
    expect(href).toContain("#w-w1");
    expect(href).not.toContain("/workers/");
  });

  it("carries the project filter and a non-default referrer into the drill", () => {
    const href = gridWorkerHref({
      workerId: "w1",
      canOpenCalendar: false,
      range: { ...range, projectId: "p1" },
      backHref: "/procurement",
    });
    expect(href).toContain("project=p1");
    expect(href).toContain("from=%2Fprocurement");
  });
});

describe("buildAttendanceGrid — roster rows (U2)", () => {
  it("adds a worker who has NO attendance in the range, as an empty row", () => {
    // The finding U1 could not express: live, 11 of 41 active workers had zero
    // July rows and therefore no row at all on a page whose job is to find them.
    const grid = build({
      rows: [row({ workerId: "a", workerName: "ก" })],
      roster: [
        { id: "a", name: "ก" },
        { id: "b", name: "ข" },
      ],
    });
    expect(grid.rows.map((r) => r.workerId)).toEqual(["a", "b"]);
    const absent = grid.rows[1];
    expect(absent?.cells).toEqual({});
    expect(absent?.daysPresent).toBe(0);
    expect(absent?.otHoursTotal).toBe(0);
  });

  it("UNIONs — a worker with attendance survives even when the roster omits them", () => {
    // Measured: 1 worker with attendance since 24 Jul is not `active`, so a
    // roster-only row set would silently drop someone the grid already showed.
    const grid = build({
      rows: [row({ workerId: "gone", workerName: "ค" })],
      roster: [{ id: "a", name: "ก" }],
    });
    expect(grid.rows.map((r) => r.workerId).sort()).toEqual(["a", "gone"]);
    expect(grid.rows.find((r) => r.workerId === "gone")?.daysPresent).toBe(1);
  });

  it("never duplicates a worker who is in BOTH", () => {
    const grid = build({
      rows: [row({ workerId: "a", workerName: "ก" })],
      roster: [{ id: "a", name: "ก" }],
    });
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0]?.daysPresent).toBe(1);
  });

  it("prefers the ATTENDANCE name, which is the one the audit rows carry", () => {
    // Both come from `workers.name`; if they ever disagree the report and its
    // own CSV must not tell two stories about the same person.
    const grid = build({
      rows: [row({ workerId: "a", workerName: "ชื่อจากบันทึก" })],
      roster: [{ id: "a", name: "ชื่ออื่น" }],
    });
    expect(grid.rows[0]?.workerName).toBe("ชื่อจากบันทึก");
  });

  it("sorts the union as one list, not roster-after-attendance", () => {
    const grid = build({
      rows: [row({ workerId: "z", workerName: "ฮ" })],
      roster: [
        { id: "z", name: "ฮ" },
        { id: "a", name: "ก" },
      ],
    });
    expect(grid.rows.map((r) => r.workerName)).toEqual(["ก", "ฮ"]);
  });

  it("draws no roster rows at all when the caller passes none", () => {
    // The three ATTENDANCE_AUDIT_ROLES outside the workers RLS policy read this
    // report through the DEFINER RPC and cannot see the roster; they keep
    // exactly today's population rather than an empty or a lie.
    const grid = build({ rows: [row({ workerId: "a", workerName: "ก" })] });
    expect(grid.rows).toHaveLength(1);
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
        project_id: null,
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
        project_id: null,
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
    // Only the three fields BOTH builders SELECT are compared. `outNextDay` and
    // `autoOut` were asserted here too and a review was right that they are
    // worthless: the grid copies them straight off the fixture row, so those
    // lines compared the fixture to buildAttendanceMonth, not one builder to the
    // other. (`autoOut` has since diverged deliberately — the grid reads it
    // across ALL sessions, the calendar off the latest — which is exactly why a
    // parity assertion on it would now be wrong.)
    expect(gridCell?.inTime).toBe(monthCell?.inTime);
    expect(gridCell?.outTime).toBe(monthCell?.outTime);
    expect(gridCell?.otHours).toBe(monthCell?.otHours);
  });

  it("breaks a timestamp TIE the same way — first row wins on both sides", () => {
    // Both builders use strict `<` / `>`, so an accidental `<=` on either side
    // would silently flip which session a tied cell displays. Nothing else in
    // the suite has two sessions at the same instant.
    const at = "2026-08-03T01:00:00+00:00";
    const sessions = [
      {
        work_date: "2026-08-03",
        in_at: at,
        out_at: at,
        in_method: "qr",
        out_method: "qr",
        out_auto: false,
        ot_hours: 0,
        project_name: "TFM โพธิ์ทอง",
        project_id: null,
      },
      {
        work_date: "2026-08-03",
        in_at: at,
        out_at: at,
        in_method: "manual",
        out_method: "manual",
        out_auto: false,
        ot_hours: 0,
        project_name: "TFM โพธิ์ทอง",
        project_id: null,
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
          session: i === 0 ? "regular" : "ot",
          inAt: s.in_at,
          // Both sessions sit on the SAME instant (01:00Z = 08:00 Bangkok), so
          // the labels must agree with it or this compares the fixture's prose
          // to buildAttendanceMonth's computed clock rather than the two merge
          // rules. The sentinels are the SECOND row's — if either builder flips
          // to last-wins, they surface.
          inTime: i === 0 ? "08:00" : "09:99",
          outAt: s.out_at,
          outTime: i === 0 ? "08:00" : "18:88",
        }),
      ),
    });
    const cell = grid.rows[0]?.cells["2026-08-03"];
    expect(cell?.inTime).toBe("08:00");
    expect(cell?.outTime).toBe("08:00");
    expect(cell?.inTime).toBe(month.cells["2026-08-03"]?.inTime);
    expect(cell?.outTime).toBe(month.cells["2026-08-03"]?.outTime);
  });
});

describe("attendanceView", () => {
  it("defaults to the grid and falls back to it for anything unrecognised", () => {
    expect(attendanceView(undefined)).toBe("grid");
    expect(attendanceView("grid")).toBe("grid");
    expect(attendanceView("nonsense")).toBe("grid");
    expect(attendanceView(["list", "grid"])).toBe("grid"); // repeated key = absent
  });

  it("keeps an explicit ?view=list", () => {
    expect(attendanceView("list")).toBe("list");
  });

  it("resolves a ?worker= URL with no ?view to the LIST, where the drill lives", () => {
    // Every drill link, bookmark and history entry the report has minted since
    // spec 358 U3 carries ?worker and no ?view. Defaulting those to the grid
    // would drop the drill the URL exists to open.
    expect(attendanceView(undefined, { workerRequested: true })).toBe("list");
    // …but an explicit ?view still wins, so a grid link is never hijacked.
    expect(attendanceView("grid", { workerRequested: true })).toBe("grid");
  });
});
