// Writing failing test first.
//
// Spec 288 U1 — GL journal CSV export (the external-accountant bridge). Pure
// helpers over the flattened journal shape: one CSV row per journal LINE with
// its parent entry fields, RFC-4180 escaping, a UTF-8 BOM so Excel opens Thai
// clean (the payroll/report export precedent), 2dp money, and the ?from/&to
// range parse (current-month fallback, same rule as parsePayrollRange).

import { describe, it, expect } from "vitest";
import {
  journalEntriesToCsv,
  buildJournalFileName,
  parseJournalRange,
  monthRangeOf,
  type JournalExportEntry,
  type JournalExportLine,
} from "@/lib/accounting/journal-export";

const BOM = "﻿";
const HEADER = "เลขที่รายการ,วันที่,ที่มา,อ้างอิงที่มา,รายละเอียด,รหัสบัญชี,ชื่อบัญชี,เดบิต,เครดิต";

function line(overrides: Partial<JournalExportLine> = {}): JournalExportLine {
  return {
    accountCode: "1010",
    accountName: "เงินสด",
    debit: 100,
    credit: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<JournalExportEntry> = {}): JournalExportEntry {
  return {
    entryNo: 1,
    entryDate: "2026-06-10",
    sourceTable: "manual",
    sourceId: "abc-123",
    memo: "รายการทดสอบ",
    lines: [line()],
    ...overrides,
  };
}

describe("journalEntriesToCsv", () => {
  it("prefixes the UTF-8 BOM and the 9-column Thai header", () => {
    const csv = journalEntriesToCsv([]);
    expect(csv.startsWith(BOM)).toBe(true);
    const firstLine = csv.slice(BOM.length).split("\n")[0];
    expect(firstLine).toBe(HEADER);
  });

  it("empty input yields header only (with trailing newline)", () => {
    const csv = journalEntriesToCsv([]);
    expect(csv).toBe(`${BOM}${HEADER}\n`);
  });

  it("flattens one CSV row per journal LINE, repeating the parent entry fields", () => {
    const csv = journalEntriesToCsv([
      entry({
        entryNo: 7,
        entryDate: "2026-06-11",
        sourceTable: "client_receipt",
        sourceId: "rcpt-9",
        memo: "รับเงินงวด",
        lines: [
          line({ accountCode: "1010", accountName: "เงินสด", debit: 500, credit: 0 }),
          line({ accountCode: "4100", accountName: "รายได้", debit: 0, credit: 500 }),
        ],
      }),
    ]);
    const rows = csv.slice(BOM.length).trimEnd().split("\n");
    expect(rows).toHaveLength(3); // header + 2 lines
    expect(rows[1]).toBe("7,2026-06-11,client_receipt,rcpt-9,รับเงินงวด,1010,เงินสด,500.00,0.00");
    expect(rows[2]).toBe("7,2026-06-11,client_receipt,rcpt-9,รับเงินงวด,4100,รายได้,0.00,500.00");
  });

  it("keeps multiple entries in the order given", () => {
    const csv = journalEntriesToCsv([
      entry({ entryNo: 1, lines: [line({ accountCode: "A" })] }),
      entry({ entryNo: 2, lines: [line({ accountCode: "B" })] }),
    ]);
    const rows = csv.slice(BOM.length).trimEnd().split("\n");
    expect(rows[1]).toContain(",A,");
    expect(rows[2]).toContain(",B,");
  });

  it("formats debit and credit to 2 decimal places", () => {
    const csv = journalEntriesToCsv([entry({ lines: [line({ debit: 1234.5, credit: 0 })] })]);
    const row = csv.slice(BOM.length).trimEnd().split("\n")[1];
    expect(row).toContain(",1234.50,0.00");
  });

  it("RFC-4180 escapes a Thai memo containing a comma, quote, or newline", () => {
    const csv = journalEntriesToCsv([entry({ memo: 'งวด1, "พิเศษ"\nโครงการ', lines: [line()] })]);
    // one field wrapped in quotes, internal quotes doubled, newline preserved
    expect(csv).toContain('"งวด1, ""พิเศษ""\nโครงการ"');
  });

  it("escapes an account name containing a comma", () => {
    const csv = journalEntriesToCsv([entry({ lines: [line({ accountName: "ลูกหนี้, การค้า" })] })]);
    expect(csv).toContain('"ลูกหนี้, การค้า"');
  });

  it("renders null memo and null source id as empty cells", () => {
    const csv = journalEntriesToCsv([
      entry({
        entryNo: 3,
        entryDate: "2026-06-12",
        sourceTable: "manual",
        sourceId: null,
        memo: null,
        lines: [line({ accountCode: "1010", accountName: "เงินสด", debit: 10, credit: 0 })],
      }),
    ]);
    const row = csv.slice(BOM.length).trimEnd().split("\n")[1];
    expect(row).toBe("3,2026-06-12,manual,,,1010,เงินสด,10.00,0.00");
  });

  it("ends with a trailing newline", () => {
    const csv = journalEntriesToCsv([entry()]);
    expect(csv.endsWith("\n")).toBe(true);
  });
});

describe("buildJournalFileName", () => {
  it("is journal-<from>-<to>.csv with dashes stripped", () => {
    expect(buildJournalFileName({ from: "2026-06-01", to: "2026-06-30" })).toBe(
      "journal-20260601-20260630.csv",
    );
  });
});

describe("monthRangeOf", () => {
  it("spans the first to last calendar day of the month", () => {
    expect(monthRangeOf("2026-06-15")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });
  it("handles December (31 days)", () => {
    expect(monthRangeOf("2026-12-09")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("handles a leap February", () => {
    expect(monthRangeOf("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("parseJournalRange", () => {
  const today = "2026-06-15";
  it("accepts a valid from<=to custom range", () => {
    expect(parseJournalRange("2026-05-01", "2026-05-20", today)).toEqual({
      from: "2026-05-01",
      to: "2026-05-20",
    });
  });
  it("falls back to the current month when a bound is missing", () => {
    expect(parseJournalRange("2026-05-01", undefined, today)).toEqual(monthRangeOf(today));
    expect(parseJournalRange(undefined, undefined, today)).toEqual(monthRangeOf(today));
  });
  it("falls back to the current month on malformed input", () => {
    expect(parseJournalRange("2026/05/01", "2026-05-20", today)).toEqual(monthRangeOf(today));
  });
  it("falls back to the current month on a DATE_RE-shaped but impossible date", () => {
    // structurally valid, calendar-impossible — must NOT reach the DB as a literal
    expect(parseJournalRange("2026-13-45", "2026-12-01", today)).toEqual(monthRangeOf(today));
    expect(parseJournalRange("2026-02-01", "2026-02-30", today)).toEqual(monthRangeOf(today));
  });
  it("falls back to the current month on an inverted range", () => {
    expect(parseJournalRange("2026-05-20", "2026-05-01", today)).toEqual(monthRangeOf(today));
  });
});
