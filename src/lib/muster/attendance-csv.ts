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
  // The stable key. `workers.name` is operator-editable free text and spec 346 is
  // actively reshaping names/nicknames, so two equal names would silently merge
  // into one payroll line with nothing in the file to tell them apart — and the
  // file could not be joined back to the app. (The PRC `employee_id` stays out:
  // it is service-role-walled PII, an open question in the spec.)
  "รหัสช่าง",
  "วันที่",
  "ช่วง",
  "เข้า",
  "ออก",
  // Set when the check-out landed on a LATER calendar day (an OT session closed
  // after midnight). Without it "17:21 – 01:30" reads as corrupt in a spreadsheet,
  // and subtracting the columns yields a negative span.
  "ออกวันถัดไป",
  "วิธีเข้า",
  "วิธีออก",
  "ออกอัตโนมัติ",
  "ชม. OT",
  "ผู้บันทึก",
  "หัวหน้าทีม",
  "โครงการ",
  "ปิดวัน",
];

/**
 * RFC 4180 quoting PLUS formula-injection defence. Excel/Sheets evaluate a cell
 * beginning `= + - @` (or tab/CR) as a formula, and `workers.name` is
 * operator-editable free text landing in a file accounting is expected to open —
 * so a name like `=HYPERLINK(...)` would execute on open. Prefixing an apostrophe
 * makes the cell literal text.
 *
 * NOTE: three older exports (`labor/payroll.ts`, `accounting/journal-export.ts`,
 * `purchase-report-view.ts`) carry the unhardened copy of this helper. Hardening
 * them is a separate sweep — recorded in the tracker's open questions — because it
 * changes files this unit does not own.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
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
        r.workerId,
        r.workDate,
        r.session === "ot" ? "OT" : "งานปกติ",
        r.inTime,
        // Blank, never prose. The report softens an open session to ยังอยู่ในงาน
        // for a human; a column a spreadsheet filters or sums must stay empty.
        r.outTime ?? "",
        r.outNextDay ? "ใช่" : "",
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
