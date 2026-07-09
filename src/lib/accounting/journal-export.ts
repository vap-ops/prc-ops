// Spec 288 U1 — GL journal CSV export for the external accountant. PURE
// (no I/O): the flattened journal shape, the CSV serializer, the filename, and
// the ?from/&to range parse. Mirrors the payroll export's pure module
// (@/lib/labor/payroll) — one CSV row per journal LINE with its parent entry
// fields, RFC-4180 escaping, a UTF-8 BOM so Excel opens Thai clean, and a
// current-month fallback for a missing/malformed/inverted range. The zero-grant
// journal read lives in load-journal-export.ts; the route gates before either.

export interface JournalExportLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface JournalExportEntry {
  entryNo: number;
  entryDate: string;
  sourceTable: string;
  sourceId: string | null;
  memo: string | null;
  lines: JournalExportLine[];
}

export interface JournalRange {
  from: string;
  to: string;
}

// RFC 4180: quote a field that contains a quote, comma, or newline; double any
// internal quote. (Same rule as payroll.ts / purchase-report-view.ts.)
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const CSV_HEADER = [
  "เลขที่รายการ", // entry_no
  "วันที่", // entry_date
  "ที่มา", // source_table (raw provenance)
  "อ้างอิงที่มา", // source_id
  "รายละเอียด", // entry memo
  "รหัสบัญชี", // account code
  "ชื่อบัญชี", // account name (name_th)
  "เดบิต", // debit
  "เครดิต", // credit
];

/** One CSV row per journal LINE, carrying its parent entry's fields. UTF-8 BOM
 * prefix so Excel reads Thai correctly (the payroll/report export precedent). */
export function journalEntriesToCsv(entries: ReadonlyArray<JournalExportEntry>): string {
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const e of entries) {
    const parent = [
      String(e.entryNo),
      csvCell(e.entryDate),
      csvCell(e.sourceTable),
      csvCell(e.sourceId ?? ""),
      csvCell(e.memo ?? ""),
    ];
    for (const l of e.lines) {
      lines.push(
        [
          ...parent,
          csvCell(l.accountCode),
          csvCell(l.accountName),
          l.debit.toFixed(2),
          l.credit.toFixed(2),
        ].join(","),
      );
    }
  }
  return "﻿" + lines.join("\n") + "\n";
}

export function buildJournalFileName(range: JournalRange): string {
  return `journal-${range.from.replaceAll("-", "")}-${range.to.replaceAll("-", "")}.csv`;
}

// First/last calendar day of the month containing `todayIso` (a Bangkok date
// string — already local, no tz math). Deterministic Date.UTC, never now().
// Date.UTC(year, month, 0): month is 0-based, so the 1-based month lands on day
// 0 of the NEXT month = last day of this one.
export function monthRangeOf(todayIso: string): JournalRange {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7)); // 1-based
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date, not just DATE_RE-shaped: reject impossible days
// (2026-13-45, 2026-02-30) that would otherwise pass to the DB as a date literal
// and 500 the export instead of falling back. Round-trips through Date so only a
// genuine y-m-d survives.
function isValidIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Accept ?from/&to; fall back to the current month on missing, malformed, or
// inverted input so a bad URL never crashes the export.
export function parseJournalRange(
  from: string | undefined,
  to: string | undefined,
  todayIso: string,
): JournalRange {
  if (from && to && isValidIsoDate(from) && isValidIsoDate(to) && from <= to) {
    return { from, to };
  }
  return monthRangeOf(todayIso);
}
