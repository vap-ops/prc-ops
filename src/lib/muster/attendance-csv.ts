// Spec 358 U4 — the payroll CSV for the attendance audit.
//
// This file is the INPUT to a payroll run, never its output: raw scan facts only
// (presence, times, provenance, closure), no baht anywhere. Wages are derived by
// spec 306 U5 from this same scan layer; conflating the two here would let two
// different money numbers exist for one day.
//
// The columns are a CONTRACT — accounting opens this in a spreadsheet — so they
// live here and are pinned by attendance-csv.test.ts, deliberately separate from
// the on-screen Thai labels, so a UI copy change can never silently reshape a
// file a downstream consumer parses (the /payroll CSV_HEADER precedent).

import type { AttendanceDetailRow, AttendanceRange } from "@/lib/muster/attendance-audit";

const CSV_HEADER = [
  "ช่าง",
  "วันที่",
  "ช่วง",
  "เข้า",
  "ออก",
  "วิธีเข้า",
  "วิธีออก",
  "ออกอัตโนมัติ",
  "ชม. OT",
  "ผู้บันทึก",
  "หัวหน้าทีม",
  "โครงการ",
  "ปิดวัน",
];

/** RFC 4180: quote only when needed, and double an embedded quote. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const METHOD_LABEL: Record<"qr" | "manual", string> = {
  qr: "สแกน QR",
  manual: "บันทึกมือ",
};

export function toAttendanceCsv(rows: AttendanceDetailRow[]): string {
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.workerName),
        r.workDate,
        r.session === "ot" ? "OT" : "งานปกติ",
        r.inTime,
        // Blank, never prose. The report softens an open session to ยังอยู่ในงาน
        // for a human; a column a spreadsheet filters or sums must stay empty.
        r.outTime ?? "",
        METHOD_LABEL[r.inMethod],
        r.outMethod ? METHOD_LABEL[r.outMethod] : "",
        r.outAuto ? "ใช่" : "ไม่",
        r.otHours === null ? "" : String(r.otHours),
        csvCell(r.scannedByName ?? ""),
        csvCell(r.teamLeadName ?? ""),
        csvCell(r.projectName),
        r.dayClosed ? "ปิดแล้ว" : "ยังไม่ปิด",
      ].join(","),
    );
  }
  // UTF-8 BOM so Excel renders the Thai names instead of mojibake.
  return "﻿" + lines.join("\n") + "\n";
}

export function attendanceCsvFilename(range: Pick<AttendanceRange, "from" | "to">): string {
  return `attendance-${range.from.replaceAll("-", "")}-${range.to.replaceAll("-", "")}.csv`;
}
