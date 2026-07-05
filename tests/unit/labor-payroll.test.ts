// Spec 69 / spec 170 U3 — DC payroll aggregation + CSV export. Pure helpers
// over labor_logs rows read via the admin client (money columns present).
// DC only (own crew are salaried, out of scope). Current-state filter
// (supersede anti-join + tombstone) runs inside, so callers pass raw rows.
// Amount = Σ (day fraction × per-row rate snapshot) — mid-period rate
// changes honoured, same rule as spec 68 cost.ts. ADR 0062: a DC is a worker,
// so payroll rolls up per WORKER (the payee), no contractor grouping.

import { describe, it, expect } from "vitest";
import {
  aggregatePayroll,
  payrollToCsv,
  buildPayrollFileName,
  monthRangeOf,
  parsePayrollRange,
  type PayrollInputRow,
} from "@/lib/labor/payroll";

function row(overrides: Partial<PayrollInputRow>): PayrollInputRow {
  return {
    id: "r1",
    worker_id: "w1",
    worker_name_snapshot: "ช่าง ก",
    pay_type_snapshot: "daily",
    day_fraction: "full",
    day_rate_snapshot: 500,
    superseded_by: null,
    work_date: "2026-06-10",
    ...overrides,
  };
}

describe("aggregatePayroll", () => {
  it("excludes own-crew rows (DC only)", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", pay_type_snapshot: "daily", day_rate_snapshot: 500 }),
      row({
        id: "b",
        worker_id: "w2",
        pay_type_snapshot: "monthly",
        day_rate_snapshot: 9999,
        worker_name_snapshot: "ลูกจ้างประจำ",
      }),
    ]);
    expect(r.workerCount).toBe(1);
    expect(r.totalAmount).toBe(500);
    expect(r.workers.map((w) => w.workerId)).toEqual(["w1"]);
  });

  it("excludes superseded and tombstone rows", () => {
    const r = aggregatePayroll([
      row({ id: "orig", worker_id: "w1", day_rate_snapshot: 500 }),
      row({
        id: "corr",
        worker_id: "w1",
        superseded_by: "orig",
        day_fraction: "half",
        day_rate_snapshot: 500,
      }),
      row({ id: "tomb", worker_id: "w2", day_fraction: null, superseded_by: "x" }),
    ]);
    // orig superseded → corr (half×500=250); tomb excluded.
    expect(r.totalAmount).toBe(250);
    expect(r.workerCount).toBe(1);
  });

  it("rolls a worker's days across work packages into one line", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", work_date: "2026-06-10", day_fraction: "full" }),
      row({ id: "b", worker_id: "w1", work_date: "2026-06-11", day_fraction: "half" }),
      row({
        id: "c",
        worker_id: "w2",
        worker_name_snapshot: "ช่าง ข",
        work_date: "2026-06-10",
        day_fraction: "full",
      }),
    ]);
    expect(r.workers).toHaveLength(2);
    const w1 = r.workers.find((w) => w.workerId === "w1")!;
    expect(w1.name).toBe("ช่าง ก");
    expect(w1.days).toBe(1.5);
    expect(w1.amount).toBe(750);
    const w2 = r.workers.find((w) => w.workerId === "w2")!;
    expect(w2.days).toBe(1);
    expect(w2.amount).toBe(500);
  });

  it("honours each row's own rate snapshot (mid-period rate change)", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", day_fraction: "full", day_rate_snapshot: 500 }),
      row({
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-11",
        day_fraction: "full",
        day_rate_snapshot: 600,
      }),
    ]);
    expect(r.workers[0]!.amount).toBe(1100);
  });

  it("sorts workers by name (th)", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", worker_name_snapshot: "ช่าง ข" }),
      row({ id: "b", worker_id: "w2", worker_name_snapshot: "ช่าง ก" }),
    ]);
    expect(r.workers.map((w) => w.name)).toEqual(["ช่าง ก", "ช่าง ข"]);
  });

  it("totals days and amount across all workers", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", day_rate_snapshot: 500 }),
      row({ id: "b", worker_id: "w2", day_fraction: "half", day_rate_snapshot: 400 }),
    ]);
    expect(r.totalDays).toBe(1.5);
    expect(r.totalAmount).toBe(700);
    expect(r.workerCount).toBe(2);
  });

  it("is empty for no rows", () => {
    expect(aggregatePayroll([])).toEqual({
      workers: [],
      totalDays: 0,
      totalAmount: 0,
      workerCount: 0,
    });
  });
});

describe("payrollToCsv", () => {
  const range = { from: "2026-06-01", to: "2026-06-30" };

  it("starts with a UTF-8 BOM and the per-worker header row", () => {
    const csv = payrollToCsv(aggregatePayroll([]), range);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\n")[0]).toBe("﻿ช่าง,จำนวนวัน,ค่าแรง (บาท)");
  });

  it("escapes fields containing comma or quote (RFC 4180)", () => {
    const csv = payrollToCsv(
      aggregatePayroll([row({ id: "a", worker_id: "w1", worker_name_snapshot: 'ช่าง, "เอก"' })]),
      range,
    );
    expect(csv).toContain('"ช่าง, ""เอก"""');
  });

  it("writes amount at 2dp, days raw, and a trailing total row", () => {
    const report = aggregatePayroll([
      row({ id: "a", worker_id: "w1", day_fraction: "half", day_rate_snapshot: 500 }),
      row({
        id: "b",
        worker_id: "w2",
        worker_name_snapshot: "ช่าง ข",
        day_fraction: "full",
        day_rate_snapshot: 380,
      }),
    ]);
    const csv = payrollToCsv(report, range);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toContain("ช่าง ก,0.5,250.00");
    expect(lines[lines.length - 1]).toBe("รวม,1.5,630.00");
  });
});

describe("buildPayrollFileName", () => {
  it("renders an ASCII payroll-dc-{from}-{to}.csv name", () => {
    expect(buildPayrollFileName({ from: "2026-06-01", to: "2026-06-30" })).toBe(
      "payroll-dc-20260601-20260630.csv",
    );
  });
});

describe("monthRangeOf", () => {
  it("returns first/last calendar day of the month", () => {
    expect(monthRangeOf("2026-06-13")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(monthRangeOf("2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("handles February length (leap and non-leap)", () => {
    expect(monthRangeOf("2024-02-10")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRangeOf("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("parsePayrollRange", () => {
  const today = "2026-06-13";

  it("passes through a valid from<=to range", () => {
    expect(parsePayrollRange("2026-06-05", "2026-06-20", today)).toEqual({
      from: "2026-06-05",
      to: "2026-06-20",
    });
  });

  it("defaults to the current month when params are missing", () => {
    expect(parsePayrollRange(undefined, undefined, today)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("defaults when a param is malformed or inverted", () => {
    expect(parsePayrollRange("nope", "2026-06-20", today)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(parsePayrollRange("2026-06-20", "2026-06-05", today)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });
});
