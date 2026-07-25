import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { shapeDetailRow } from "@/lib/muster/attendance-audit";
import { attendanceCsvFilename, toAttendanceCsv } from "@/lib/muster/attendance-csv";

// Spec 358 U4 — the payroll CSV. This is the input to a payroll run, never its
// output: raw scan facts only, no baht anywhere. The columns are a CONTRACT a
// downstream consumer (accounting's spreadsheet) reads, so they are pinned here
// rather than left to the render.

type Raw = Parameters<typeof shapeDetailRow>[0];

const RAW: Raw = {
  worker_id: "3f4b2c1a-0000-4000-8000-000000000001",
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

const rows = (...over: Partial<Raw>[]) => over.map((o) => shapeDetailRow({ ...RAW, ...o }));
const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\n");

describe("toAttendanceCsv (spec 358 U4)", () => {
  it("starts with a UTF-8 BOM so Excel renders the Thai names", () => {
    // Without it accounting opens the file to mojibake — the whole point of the
    // export is that a human reads the worker names.
    expect(toAttendanceCsv(rows({}))).toMatch(/^﻿/);
  });

  it("emits a header row naming every column", () => {
    const [header] = lines(toAttendanceCsv(rows({})));
    expect(header?.split(",")).toEqual([
      "ช่าง",
      "รหัสช่าง",
      "วันที่",
      "ช่วง",
      "เข้า",
      "ออก",
      "ออกวันถัดไป",
      "วิธีเข้า",
      "วิธีออก",
      "ออกอัตโนมัติ",
      "ชม. OT",
      "ผู้บันทึก",
      "หัวหน้าทีม",
      "โครงการ",
      "ปิดวัน",
    ]);
  });

  it("emits one line per session with the Bangkok wall-clock times", () => {
    const out = lines(toAttendanceCsv(rows({})));
    expect(out).toHaveLength(2); // header + 1 row
    const cells = out[1]?.split(",");
    expect(cells?.[0]).toBe("ช่าง หนึ่ง");
    expect(cells?.[1]).toBe("3f4b2c1a-0000-4000-8000-000000000001");
    expect(cells?.[2]).toBe("2026-07-24");
    expect(cells?.[3]).toBe("งานปกติ");
    expect(cells?.[4]).toBe("08:38");
    expect(cells?.[5]).toBe("17:00");
    expect(cells?.[7]).toBe("บันทึกมือ");
    expect(cells?.[8]).toBe("บันทึกมือ");
    expect(cells?.[9]).toBe("ไม่");
    expect(cells?.[13]).toBe("โครงการเอ");
    expect(cells?.[14]).toBe("ยังไม่ปิด");
  });

  it("leaves the out cell EMPTY when there is no check-out — never a guess", () => {
    // The report softens this to ยังอยู่ในงาน for a human reader, but a CSV column
    // a spreadsheet sums must stay blank rather than carry prose.
    const cells = lines(toAttendanceCsv(rows({ out_at: null, out_method: null })))[1]?.split(",");
    expect(cells?.[5]).toBe("");
    expect(cells?.[8]).toBe("");
  });

  it("writes the OT span and the ot session label", () => {
    const cells = lines(toAttendanceCsv(rows({ session: "ot", ot_hours: 2.5 })))[1]?.split(",");
    expect(cells?.[3]).toBe("OT");
    expect(cells?.[10]).toBe("2.5");
  });

  it("marks an auto check-out and a closed day", () => {
    const cells = lines(toAttendanceCsv(rows({ out_auto: true, day_closed: true })))[1]?.split(",");
    expect(cells?.[9]).toBe("ใช่");
    expect(cells?.[14]).toBe("ปิดแล้ว");
  });

  it("blanks a null scanner / lead rather than printing null", () => {
    const cells = lines(
      toAttendanceCsv(rows({ scanned_by_name: null, team_lead_name: null })),
    )[1]?.split(",");
    expect(cells?.[11]).toBe("");
    expect(cells?.[12]).toBe("");
  });

  it("quotes a cell containing a comma, quote or newline (RFC 4180)", () => {
    const csv = toAttendanceCsv(rows({ worker_name: 'ช่าง, "หนึ่ง"' }));
    expect(csv).toContain('"ช่าง, ""หนึ่ง"""');
  });

  it("emits header-only for no rows — a valid file, not an empty one", () => {
    expect(lines(toAttendanceCsv([]))).toHaveLength(1);
  });

  // Excel/Sheets EXECUTE a cell beginning = + - @, and workers.name is
  // operator-editable free text landing in a file accounting is told to open.
  it("neutralises a formula-injection payload in an operator-editable name", () => {
    const csv = toAttendanceCsv(rows({ worker_name: '=HYPERLINK("http://evil")' }));
    expect(csv).toContain("'=HYPERLINK");
    // Never the bare formula straight after the delimiter or the BOM.
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    for (const lead of ["+1", "-1", "@x"]) {
      expect(toAttendanceCsv(rows({ worker_name: lead }))).toContain(`'${lead}`);
    }
  });

  // Language-agnostic shape guard: the banned-word list below only catches Thai
  // money words, so an added `day_rate` column would slip past it. A fixed cell
  // count fails on ANY new column, whatever it is named.
  it("emits exactly 15 cells per row — any added column reds this", () => {
    const out = lines(toAttendanceCsv(rows({}, { session: "ot", ot_hours: 2 })));
    expect(out).toHaveLength(3);
    for (const line of out) expect(line.split(",")).toHaveLength(15);
  });

  it("carries NO money column — attendance is scan truth, wages are spec 306 U5", () => {
    const csv = toAttendanceCsv(rows({}));
    for (const banned of ["บาท", "ค่าแรง", "สุทธิ", "หัก ณ ที่จ่าย"]) {
      expect(csv).not.toContain(banned);
    }
  });
});

describe("attendanceCsvFilename (spec 358 U4)", () => {
  it("names the file for the range so two exports never collide", () => {
    expect(attendanceCsvFilename({ from: "2026-07-01", to: "2026-07-31" })).toBe(
      "attendance-20260701-20260731.csv",
    );
  });
});

// Spec 358 U4 — gate PARITY across the three layers. The RPC's inner allowlist,
// the page gate and the export gate must be the SAME set: a role that can see the
// report must be able to export exactly what it sees, and no other role may reach
// either. Spec 187's payroll bug is the counter-example — the affordance and the
// RPC agreed while the middle layer refused on click.
describe("export route gate parity (spec 358 U4)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  // ⚠️ ANCHORED, not `toContain`: the first version of this test passed with the
  // gate replaced by a COMMENT that merely quoted the call (proven by mutation) —
  // the fake-coverage trap. The regex requires the awaited call at the start of a
  // line, so a comment or a quoted string no longer satisfies it.
  it("the export route AWAITS the gate as real code, not in a comment", () => {
    const route = read("src/app/team/attendance/export/route.ts");
    expect(route).toMatch(/^\s*await requireRole\(ATTENDANCE_AUDIT_ROLES\);/m);
    // Never the admin client: an export must not widen what its viewer may read.
    expect(route).not.toContain("db/admin");
    expect(route).toContain("createServerClient");
  });

  // A one-sided "parity" test proves nothing. Pin the PAGE side too, so the two
  // can only drift by editing both — the payroll-export-gate precedent.
  it("the page gates on that SAME set, so file and screen can never diverge", () => {
    const page = read("src/app/team/attendance/page.tsx");
    expect(page).toMatch(/^\s*const ctx = await requireRole\(ATTENDANCE_AUDIT_ROLES\);/m);
  });

  // Prefetching a route handler RUNS it (verified: a prefetch request reaches the
  // handler and returns 307), so next/link on an export would build the whole CSV
  // for every viewer with zero clicks. The repo documents <a download> for this.
  it("the export link is a plain <a download>, never next/link", () => {
    const page = read("src/app/team/attendance/page.tsx");
    expect(page).toMatch(/<a href=\{exportHref\} download/);
    expect(page).not.toMatch(/<Link\s+href=\{exportHref\}/);
  });

  it("reuses the page's range parser so the file and the screen cannot disagree", () => {
    const route = read("src/app/team/attendance/export/route.ts");
    expect(route).toContain("attendanceRange(");
  });

  it("streams csv with a download filename and no caching", () => {
    const route = read("src/app/team/attendance/export/route.ts");
    expect(route).toContain("text/csv; charset=utf-8");
    expect(route).toContain("Content-Disposition");
    expect(route).toContain("no-store");
  });
});
