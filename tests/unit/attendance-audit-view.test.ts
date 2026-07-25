import { describe, expect, it } from "vitest";

import {
  attendanceRange,
  formatSignals,
  unclosedDaySignal,
  type AttendanceSummaryRow,
} from "@/lib/muster/attendance-audit";

// Spec 358 U2 — the attendance-audit report's pure view-model: how a request's
// searchParams become a date range, and how a summary row's audit-signal counts
// become the chips that tell an auditor which rows deserve scrutiny.

const TODAY = "2026-07-25";

function row(over: Partial<AttendanceSummaryRow> = {}): AttendanceSummaryRow {
  return {
    workerId: "w1",
    workerName: "ช่าง หนึ่ง",
    daysPresent: 3,
    otHoursTotal: 2,
    projectCount: 1,
    manualInCount: 0,
    qrInCount: 0,
    autoOutCount: 0,
    openOutCount: 0,
    unclosedDayCount: 0,
    ...over,
  };
}

describe("attendanceRange (spec 358 U2)", () => {
  it("defaults to the current Bangkok month, through today", () => {
    expect(attendanceRange({}, TODAY)).toEqual({ from: "2026-07-01", to: TODAY });
  });

  it("honours an explicit ?start/?end", () => {
    expect(attendanceRange({ start: "2026-06-01", end: "2026-06-30" }, TODAY)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("falls back per-field when a date is not an ISO date", () => {
    expect(attendanceRange({ start: "last week", end: "2026-07-10" }, TODAY)).toEqual({
      from: "2026-07-01",
      to: "2026-07-10",
    });
    expect(attendanceRange({ start: "2026-07-05", end: "nonsense" }, TODAY)).toEqual({
      from: "2026-07-05",
      to: TODAY,
    });
  });

  it("swaps a reversed range so from <= to always holds", () => {
    expect(attendanceRange({ start: "2026-07-20", end: "2026-07-02" }, TODAY)).toEqual({
      from: "2026-07-02",
      to: "2026-07-20",
    });
  });

  it("carries a project filter only when one is given", () => {
    const PROJECT = "3f4b2c1a-0000-4000-8000-000000000abc";
    expect(attendanceRange({ project: PROJECT }, TODAY).projectId).toBe(PROJECT);
    expect(attendanceRange({ project: "  " }, TODAY).projectId).toBeUndefined();
    expect(attendanceRange({}, TODAY).projectId).toBeUndefined();
  });

  it("ignores a repeated-key array (the ?start=a&start=b shape)", () => {
    expect(attendanceRange({ start: ["2026-07-02", "2026-07-03"] }, TODAY).from).toBe("2026-07-01");
  });

  it("rejects a calendar-invalid date (shape-valid but not a real day)", () => {
    // 2026-02-30 passes ISO_DATE_REGEX but 22008s in SQL, and the error page's
    // reset() re-renders the same params — a permanent dead end.
    expect(attendanceRange({ start: "2026-02-30", end: "2026-07-10" }, TODAY).from).toBe(
      "2026-07-01",
    );
    expect(attendanceRange({ start: "2026-13-01" }, TODAY).from).toBe("2026-07-01");
  });

  it("ignores a non-uuid project param — it would 22P02 in SQL", () => {
    expect(attendanceRange({ project: "not-a-uuid" }, TODAY).projectId).toBeUndefined();
    expect(
      attendanceRange({ project: "3f4b2c1a-0000-4000-8000-000000000abc" }, TODAY).projectId,
    ).toBe("3f4b2c1a-0000-4000-8000-000000000abc");
  });

  // ?from is reserved repo-wide for the back-referrer written by withBackFrom
  // (/payroll renamed its range params for this same collision). If someone
  // "helpfully" re-reads ?from as the range start, this reds: a /team entry link
  // carries ?from=%2Fteam, which is not a date and must never move the range.
  it("never reads ?from as the range start — that param is the back-referrer", () => {
    const range = attendanceRange(
      { start: "2026-07-05", from: "/team" } as Parameters<typeof attendanceRange>[0],
      TODAY,
    );
    expect(range.from).toBe("2026-07-05");
  });
});

describe("formatSignals (spec 358 U2)", () => {
  it("emits nothing for a clean row", () => {
    expect(formatSignals(row())).toEqual([]);
  });

  it("emits a chip per non-zero signal, never for a zero one", () => {
    const chips = formatSignals(row({ manualInCount: 4, autoOutCount: 1, openOutCount: 2 }));
    expect(chips.map((c) => c.key)).toEqual(["manual", "autoOut", "openOut"]);
    expect(chips.map((c) => c.count)).toEqual([4, 1, 2]);
  });

  it("carries the count inside the Thai label so the chip reads on its own", () => {
    const [chip] = formatSignals(row({ openOutCount: 2 }));
    expect(chip?.label).toContain("2");
    expect(chip?.label).toContain("ยังไม่เช็คออก");
  });

  // The unclosed-day count is a PROJECT-DAY fact — identical for every worker on
  // that day — so per-worker chips repeated one missed ปิดวัน as N findings
  // against N people. It belongs in the header, once.
  it("never chips the unclosed-day count — it is a project fact, not a worker's", () => {
    const chips = formatSignals(row({ unclosedDayCount: 3 }));
    expect(chips).toEqual([]);
    expect(chips.map((c) => c.key)).not.toContain("unclosed");
  });

  it("takes the MAX unclosed count across rows, never the sum", () => {
    // 3 workers on the same 2 unclosed project-days must read 2, not 6.
    const rows = [row({ unclosedDayCount: 2 }), row({ unclosedDayCount: 2 }), row()];
    expect(unclosedDaySignal(rows)).toBe(2);
    expect(unclosedDaySignal([])).toBe(0);
  });

  // Mid-shift every worker on site legitimately has out_at NULL (there is no
  // auto-out cron), so the finding wording would flag the whole crew daily.
  it("softens the open-check-out chip to ยังอยู่ในงาน when the range reaches today", () => {
    const [chip] = formatSignals(row({ openOutCount: 14 }), { rangeIncludesToday: true });
    expect(chip?.label).toBe("ยังอยู่ในงาน 14");
    expect(chip?.count).toBe(14);
    // A past-only range keeps the finding wording — never checked out IS a defect.
    const [past] = formatSignals(row({ openOutCount: 14 }), { rangeIncludesToday: false });
    expect(past?.label).toBe("ยังไม่เช็คออก 14");
  });

  it("does NOT chip qr check-ins — a QR scan is the good case, not a finding", () => {
    expect(formatSignals(row({ qrInCount: 9 }))).toEqual([]);
  });

  it("flags a fully-manual row (no QR proof) — the live pilot's shape", () => {
    const chips = formatSignals(row({ manualInCount: 2, qrInCount: 0, openOutCount: 1 }));
    expect(chips.map((c) => c.key)).toEqual(["manual", "openOut"]);
  });
});
