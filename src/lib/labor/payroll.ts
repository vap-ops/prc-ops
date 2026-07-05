// Spec 69 / spec 170 U3 — ค่าแรง (wage) payroll aggregation + CSV export. Runs over
// labor_logs rows read via the admin client (day_rate_snapshot present —
// authenticated sessions can never read it, by column grant). daily ช่าง only:
// own crew are salaried, out of scope. amount = Σ (day fraction × per-row rate snapshot),
// the same rule as spec 68 cost.ts. The current-state filter (supersede
// anti-join + tombstone, ADR 0009/0015) runs here so callers pass raw rows.
// Pure — no UI, no I/O. Money is rendered only on the PM payroll surfaces
// (requireRole-gated). ADR 0062: a ช่าง binds on workers.user_id (the payee), so payroll rolls
// up per worker — there is no contractor grouping.

import type { Database } from "@/lib/db/database.types";

type Row = Database["public"]["Tables"]["labor_logs"]["Row"];
type DayFraction = Database["public"]["Enums"]["day_fraction"];

// Money column (day_rate_snapshot) included — pinned to the schema Row so a
// column rename is a type error here.
export type PayrollInputRow = Pick<
  Row,
  | "id"
  | "worker_id"
  | "worker_name_snapshot"
  | "pay_type_snapshot"
  | "day_fraction"
  | "day_rate_snapshot"
  | "superseded_by"
  | "work_date"
>;

export interface WorkerPay {
  workerId: string;
  name: string;
  days: number;
  amount: number;
}

export interface PayrollReport {
  workers: WorkerPay[];
  totalDays: number;
  totalAmount: number;
  workerCount: number;
}

export interface PayrollRange {
  from: string;
  to: string;
}

// Current rows only: drop anything pointed at by superseded_by, then drop
// tombstones (NULL fraction). Trivially replicated (not cross-imported) to
// keep this module decoupled from cost.ts / current-logs.ts.
function currentRows<
  T extends { id: string; superseded_by: string | null; day_fraction: DayFraction | null },
>(rows: ReadonlyArray<T>): T[] {
  const superseded = new Set(
    rows.map((r) => r.superseded_by).filter((id): id is string => id !== null),
  );
  return rows.filter((r) => !superseded.has(r.id) && r.day_fraction !== null);
}

function fractionDays(f: DayFraction): number {
  return f === "full" ? 1 : 0.5;
}

export function aggregatePayroll(rows: ReadonlyArray<PayrollInputRow>): PayrollReport {
  // Filter to current state across ALL pay types FIRST, then keep daily-pay
  // (daily ช่าง): a supersede correction re-snapshots pay_type, so a DB-level type
  // filter could drop a superseding row and miscount the stale one (spec 69).
  const current = currentRows(rows).filter((r) => r.pay_type_snapshot === "daily");

  // worker_id -> rolled-up pay line (the worker is the payee, ADR 0062).
  const byWorker = new Map<string, WorkerPay>();
  let totalDays = 0;
  let totalAmount = 0;

  for (const r of current) {
    const days = fractionDays(r.day_fraction as DayFraction);
    const amount = days * r.day_rate_snapshot;

    const line = byWorker.get(r.worker_id);
    if (line) {
      line.days += days;
      line.amount += amount;
    } else {
      byWorker.set(r.worker_id, {
        workerId: r.worker_id,
        name: r.worker_name_snapshot,
        days,
        amount,
      });
    }

    totalDays += days;
    totalAmount += amount;
  }

  const workers = Array.from(byWorker.values()).sort((a, b) => a.name.localeCompare(b.name, "th"));

  return { workers, totalDays, totalAmount, workerCount: workers.length };
}

// RFC 4180: quote a field that contains a quote, comma, or newline; double
// any internal quote.
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const CSV_HEADER = ["ช่าง", "จำนวนวัน", "ค่าแรง (บาท)"];

export function payrollToCsv(report: PayrollReport, _range: PayrollRange): string {
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const w of report.workers) {
    lines.push([csvCell(w.name), String(w.days), w.amount.toFixed(2)].join(","));
  }
  lines.push(["รวม", String(report.totalDays), report.totalAmount.toFixed(2)].join(","));
  // UTF-8 BOM so Excel reads Thai correctly.
  return "﻿" + lines.join("\n") + "\n";
}

export function buildPayrollFileName(range: PayrollRange): string {
  return `payroll-dc-${range.from.replaceAll("-", "")}-${range.to.replaceAll("-", "")}.csv`;
}

// First/last calendar day of the month containing `todayIso` (a Bangkok
// date string — already local, no tz math). Deterministic Date.UTC, never
// now().
export function monthRangeOf(todayIso: string): PayrollRange {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7)); // 1-based
  const mm = String(month).padStart(2, "0");
  // Date.UTC(year, month, 0): month is 0-based, so passing the 1-based month
  // lands on day 0 of the NEXT month = last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Accept ?from/&to query params; fall back to the current month on missing,
// malformed, or inverted input so a bad URL never crashes the page.
export function parsePayrollRange(
  from: string | undefined,
  to: string | undefined,
  todayIso: string,
): PayrollRange {
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to) {
    return { from, to };
  }
  return monthRangeOf(todayIso);
}
