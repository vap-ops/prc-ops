// Spec 69 / spec 170 U3 / spec 314 U4 — DC payroll aggregation + CSV export. Pure
// helpers over labor_logs rows read via the admin client (money columns present).
// DC only (own crew are salaried, out of scope). Current-state filter
// (supersede anti-join + tombstone) runs inside, so callers pass raw rows.
// Gross = Σ (day fraction × per-row gross rate snapshot) — mid-period rate
// changes honoured, same rule as spec 68 cost.ts. Spec 314 U4: each row also
// carries a frozen WHT % (wht_pct_snapshot); wht = round2(gross × pct/100) per
// row, net = gross − wht. A null snapshot means 0% (no withholding). ADR 0062:
// a DC is a worker, so payroll rolls up per WORKER (the payee), no contractor
// grouping.

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
    wht_pct_snapshot: null,
    superseded_by: null,
    work_date: "2026-06-10",
    work_package_id: "wp1",
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
    expect(r.totalGross).toBe(500);
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
    expect(r.totalGross).toBe(250);
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
    expect(w1.gross).toBe(750);
    const w2 = r.workers.find((w) => w.workerId === "w2")!;
    expect(w2.days).toBe(1);
    expect(w2.gross).toBe(500);
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
    expect(r.workers[0]!.gross).toBe(1100);
  });

  it("sorts workers by name (th)", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", worker_name_snapshot: "ช่าง ข" }),
      row({ id: "b", worker_id: "w2", worker_name_snapshot: "ช่าง ก" }),
    ]);
    expect(r.workers.map((w) => w.name)).toEqual(["ช่าง ก", "ช่าง ข"]);
  });

  it("totals days and gross across all workers", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", day_rate_snapshot: 500 }),
      row({ id: "b", worker_id: "w2", day_fraction: "half", day_rate_snapshot: 400 }),
    ]);
    expect(r.totalDays).toBe(1.5);
    expect(r.totalGross).toBe(700);
    expect(r.workerCount).toBe(2);
  });

  it("is empty for no rows", () => {
    expect(aggregatePayroll([])).toEqual({
      workers: [],
      totalDays: 0,
      totalGross: 0,
      totalWht: 0,
      totalNet: 0,
      workerCount: 0,
    });
  });
});

// Spec 314 U4 — WHT (หัก ณ ที่จ่าย) split. Each row freezes the firm WHT % at log
// time (wht_pct_snapshot); wht = round2(gross × pct/100) per row, net = gross − wht.
describe("aggregatePayroll WHT / net", () => {
  it("splits gross into wht and net for a single worker", () => {
    const r = aggregatePayroll([
      row({
        id: "a",
        worker_id: "w1",
        day_fraction: "full",
        day_rate_snapshot: 1000,
        wht_pct_snapshot: 3,
      }),
    ]);
    const w1 = r.workers[0]!;
    expect(w1.gross).toBe(1000);
    expect(w1.wht).toBe(30);
    expect(w1.net).toBe(970);
    expect(r.totalGross).toBe(1000);
    expect(r.totalWht).toBe(30);
    expect(r.totalNet).toBe(970);
  });

  it("treats a null wht snapshot as 0% (no withholding)", () => {
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", day_rate_snapshot: 800, wht_pct_snapshot: null }),
    ]);
    const w1 = r.workers[0]!;
    expect(w1.gross).toBe(800);
    expect(w1.wht).toBe(0);
    expect(w1.net).toBe(800);
  });

  it("withholds per row on a half day", () => {
    const r = aggregatePayroll([
      row({
        id: "a",
        worker_id: "w1",
        day_fraction: "half",
        day_rate_snapshot: 1000,
        wht_pct_snapshot: 3,
      }),
    ]);
    const w1 = r.workers[0]!;
    expect(w1.gross).toBe(500);
    expect(w1.wht).toBe(15);
    expect(w1.net).toBe(485);
  });

  it("rounds the per-row withholding to 2dp (both directions)", () => {
    // Pin round2 actually rounding a fractional product, not just exact 2dp values.
    // up: half day 666.66 → gross 333.33; 333.33×3% = 9.9999 → 10.00; net 323.33.
    const up = aggregatePayroll([
      row({
        id: "u",
        worker_id: "w1",
        day_fraction: "half",
        day_rate_snapshot: 666.66,
        wht_pct_snapshot: 3,
      }),
    ]).workers[0]!;
    expect(up.gross).toBe(333.33);
    expect(up.wht).toBe(10);
    expect(up.net).toBe(323.33);
    // down: full day 100.10 → gross 100.10; 100.10×3% = 3.003 → 3.00; net 97.10.
    const down = aggregatePayroll([
      row({
        id: "d",
        worker_id: "w2",
        day_fraction: "full",
        day_rate_snapshot: 100.1,
        wht_pct_snapshot: 3,
      }),
    ]).workers[0]!;
    expect(down.gross).toBe(100.1);
    expect(down.wht).toBe(3);
    expect(down.net).toBe(97.1);
  });

  it("sums wht/net across rows with DIFFERENT frozen % (mid-period % change)", () => {
    // A firm WHT %-change between the two logged days: each row keeps its own
    // frozen snapshot, so the withholding is computed per row and summed.
    const r = aggregatePayroll([
      row({ id: "a", worker_id: "w1", day_rate_snapshot: 1000, wht_pct_snapshot: 3 }),
      row({
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-11",
        day_rate_snapshot: 1000,
        wht_pct_snapshot: 5,
      }),
    ]);
    const w1 = r.workers[0]!;
    expect(w1.gross).toBe(2000);
    expect(w1.wht).toBe(80); // 30 + 50
    expect(w1.net).toBe(1920);
    expect(r.totalWht).toBe(80);
    expect(r.totalNet).toBe(1920);
  });
});

// Spec 309 — project scope. When a work-package set is passed, the per-worker
// roll-up keeps only rows on those WPs — but the scope is applied AFTER the
// current-state + daily pass (a supersede correction can re-snapshot a row onto
// a different WP/project, so a DB-level filter could miscount, spec 69 caution).
describe("aggregatePayroll project scope", () => {
  it("keeps only rows whose work_package_id is in the set", () => {
    const r = aggregatePayroll(
      [
        row({ id: "a", worker_id: "w1", work_package_id: "wpA", day_rate_snapshot: 500 }),
        row({
          id: "b",
          worker_id: "w2",
          worker_name_snapshot: "ช่าง ข",
          work_package_id: "wpB",
          day_rate_snapshot: 500,
        }),
      ],
      { workPackageIds: new Set(["wpA"]) },
    );
    expect(r.workerCount).toBe(1);
    expect(r.workers.map((w) => w.workerId)).toEqual(["w1"]);
    expect(r.totalGross).toBe(500);
  });

  it("applies the scope AFTER the supersede anti-join (correction moved the WP)", () => {
    // orig on wpA is superseded by corr, which moved the day to wpB. The
    // anti-join runs over the FULL set first, so orig is dropped; only corr (wpB)
    // survives. Scoping to wpA must NOT resurrect orig → project A sees nothing.
    const rows = [
      row({ id: "orig", worker_id: "w1", work_package_id: "wpA", day_rate_snapshot: 500 }),
      row({
        id: "corr",
        worker_id: "w1",
        work_package_id: "wpB",
        superseded_by: "orig",
        day_rate_snapshot: 500,
      }),
    ];
    expect(aggregatePayroll(rows, { workPackageIds: new Set(["wpA"]) }).totalGross).toBe(0);
    expect(aggregatePayroll(rows, { workPackageIds: new Set(["wpB"]) }).totalGross).toBe(500);
  });

  it("includes every row when no set is given (all projects)", () => {
    const rows = [
      row({ id: "a", worker_id: "w1", work_package_id: "wpA" }),
      row({ id: "b", worker_id: "w2", work_package_id: "wpB" }),
    ];
    expect(aggregatePayroll(rows).workerCount).toBe(2);
    expect(aggregatePayroll(rows, {}).workerCount).toBe(2);
  });
});

describe("payrollToCsv", () => {
  const range = { from: "2026-06-01", to: "2026-06-30" };

  it("starts with a UTF-8 BOM and the per-worker header row", () => {
    const csv = payrollToCsv(aggregatePayroll([]), range);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\n")[0]).toBe("﻿ช่าง,จำนวนวัน,ค่าแรง (บาท),หัก ณ ที่จ่าย,สุทธิ");
  });

  it("escapes fields containing comma or quote (RFC 4180)", () => {
    const csv = payrollToCsv(
      aggregatePayroll([row({ id: "a", worker_id: "w1", worker_name_snapshot: 'ช่าง, "เอก"' })]),
      range,
    );
    expect(csv).toContain('"ช่าง, ""เอก"""');
  });

  it("writes gross/wht/net at 2dp, days raw, and a trailing total row", () => {
    const report = aggregatePayroll([
      row({
        id: "a",
        worker_id: "w1",
        day_fraction: "full",
        day_rate_snapshot: 1000,
        wht_pct_snapshot: 3,
      }),
      row({
        id: "b",
        worker_id: "w2",
        worker_name_snapshot: "ช่าง ข",
        day_fraction: "half",
        day_rate_snapshot: 1000,
        wht_pct_snapshot: 3,
      }),
    ]);
    const csv = payrollToCsv(report, range);
    const lines = csv.trimEnd().split("\n");
    // w1: gross 1000, wht 30, net 970
    expect(lines).toContain("ช่าง ก,1,1000.00,30.00,970.00");
    // w2: half day → gross 500, wht 15, net 485
    expect(lines).toContain("ช่าง ข,0.5,500.00,15.00,485.00");
    // total: gross 1500, wht 45, net 1455
    expect(lines[lines.length - 1]).toBe("รวม,1.5,1500.00,45.00,1455.00");
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
