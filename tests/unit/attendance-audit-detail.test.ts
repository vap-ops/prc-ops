import { describe, expect, it } from "vitest";

import {
  attendanceWorkerId,
  shapeDetailRow,
  groupDetailByDate,
} from "@/lib/muster/attendance-audit";

// Spec 358 U3 — the per-day drill-down's view-model. This is where a summary
// signal COUNT becomes an inspectable per-session FACT: which check-in was
// manual, which check-out the system wrote, who recorded it, and whether the
// day was ever closed. The summary says "look here"; this says what is there.

// Mirrors the RPC's row shape with the genuinely-nullable columns typed nullable
// (out_at/out_method/ot_hours are nullable columns; scanned_by_name/team_lead_name
// come from LEFT joins) — db:types marks them all non-null, which is exactly the
// widening the consumer has to do.
type Raw = Parameters<typeof shapeDetailRow>[0];

const RAW: Raw = {
  worker_id: "w1",
  worker_name: "ช่าง หนึ่ง",
  project_id: "p1",
  project_name: "โครงการเอ",
  work_date: "2026-07-24",
  session: "regular",
  in_at: "2026-07-24T01:38:00Z", // 08:38 BKK
  in_method: "manual",
  out_at: "2026-07-24T10:00:00Z", // 17:00 BKK
  out_method: "manual",
  out_auto: false,
  ot_hours: null,
  scanned_by: "u1",
  scanned_by_name: "อรปรีญา เงางาม",
  team_lead_name: "จันทร์ เงางาม",
  day_closed: false,
};

function raw(over: Partial<Raw> = {}): Raw {
  return { ...RAW, ...over };
}

describe("shapeDetailRow (spec 358 U3)", () => {
  it("maps a completed regular session with both times", () => {
    const row = shapeDetailRow(raw());
    expect(row.workerId).toBe("w1");
    expect(row.workDate).toBe("2026-07-24");
    expect(row.session).toBe("regular");
    expect(row.inMethod).toBe("manual");
    expect(row.outAt).not.toBeNull();
    expect(row.stillIn).toBe(false);
    expect(row.scannedByName).toBe("อรปรีญา เงางาม");
    expect(row.teamLeadName).toBe("จันทร์ เงางาม");
    expect(row.dayClosed).toBe(false);
  });

  it("flags a session with no check-out as stillIn", () => {
    const row = shapeDetailRow(raw({ out_at: null, out_method: null }));
    expect(row.stillIn).toBe(true);
    expect(row.outAt).toBeNull();
    expect(row.outMethod).toBeNull();
  });

  it("carries the OT span on an ot session", () => {
    const row = shapeDetailRow(raw({ session: "ot", ot_hours: 2.5 }));
    expect(row.session).toBe("ot");
    expect(row.otHours).toBe(2.5);
  });

  // db:types marks every RETURNS-TABLE column non-null, but scanned_by_name and
  // team_lead_name come from LEFT joins and ot_hours/out_at are nullable columns —
  // the consumer must widen them or a missing user row crashes the render.
  it("tolerates a null scanner / lead name (both are LEFT joins)", () => {
    const row = shapeDetailRow(
      raw({ scanned_by_name: null, team_lead_name: null, ot_hours: null }),
    );
    expect(row.scannedByName).toBeNull();
    expect(row.teamLeadName).toBeNull();
    expect(row.otHours).toBeNull();
  });

  it("marks an auto check-out — the system wrote it, not a person", () => {
    const row = shapeDetailRow(raw({ out_auto: true }));
    expect(row.outAuto).toBe(true);
  });

  it("renders in/out as Bangkok wall-clock times, not UTC", () => {
    const row = shapeDetailRow(raw());
    // 01:38Z is 08:38 in Asia/Bangkok (+07). A UTC render would read 01:38 and
    // make every morning check-in look like a pre-dawn scan.
    expect(row.inTime).toBe("08:38");
    expect(row.outTime).toBe("17:00");
  });

  it("leaves the out time blank when the worker never checked out", () => {
    const row = shapeDetailRow(raw({ out_at: null, out_method: null }));
    expect(row.outTime).toBeNull();
  });
});

describe("attendanceWorkerId (spec 358 U3)", () => {
  const VISIBLE = ["3f4b2c1a-0000-4000-8000-000000000001", "3f4b2c1a-0000-4000-8000-000000000002"];

  it("accepts a uuid that is in the visible summary rows", () => {
    expect(attendanceWorkerId(VISIBLE[0], VISIBLE)).toBe(VISIBLE[0]);
  });

  it("rejects a uuid that is NOT in the visible rows — no drill outside your scope", () => {
    // The RPC scopes by role/membership anyway, so this is defence in depth AND
    // avoids a pointless round-trip that would render an empty drill.
    expect(attendanceWorkerId("3f4b2c1a-0000-4000-8000-0000000000ff", VISIBLE)).toBeNull();
  });

  it("rejects a non-uuid before it can reach SQL as 22P02", () => {
    expect(attendanceWorkerId("not-a-uuid", VISIBLE)).toBeNull();
    expect(attendanceWorkerId("", VISIBLE)).toBeNull();
  });

  it("returns null when absent, and ignores a repeated-key array", () => {
    expect(attendanceWorkerId(undefined, VISIBLE)).toBeNull();
    expect(attendanceWorkerId([VISIBLE[0]!, VISIBLE[1]!], VISIBLE)).toBeNull();
  });
});

describe("groupDetailByDate (spec 358 U3)", () => {
  it("groups rows by work_date, newest day first", () => {
    const rows = [
      shapeDetailRow(raw({ work_date: "2026-07-22" })),
      shapeDetailRow(raw({ work_date: "2026-07-24" })),
      shapeDetailRow(raw({ work_date: "2026-07-23" })),
    ];
    expect(groupDetailByDate(rows).map((g) => g.workDate)).toEqual([
      "2026-07-24",
      "2026-07-23",
      "2026-07-22",
    ]);
  });

  it("keeps regular before ot within a day", () => {
    const rows = [
      shapeDetailRow(raw({ session: "ot", ot_hours: 2 })),
      shapeDetailRow(raw({ session: "regular" })),
    ];
    const [day] = groupDetailByDate(rows);
    expect(day?.sessions.map((s) => s.session)).toEqual(["regular", "ot"]);
  });

  it("carries the day's closure state onto the group, not each session", () => {
    const rows = [shapeDetailRow(raw({ day_closed: true }))];
    const [day] = groupDetailByDate(rows);
    // Closure is a project-DAY fact (the U2 lesson) — it belongs to the day header.
    expect(day?.dayClosed).toBe(true);
  });

  it("returns nothing for no rows", () => {
    expect(groupDetailByDate([])).toEqual([]);
  });
});
