// Spec 69 / spec 170 U3 / spec 314 U4 — ค่าแรง (wage) payroll aggregation + CSV
// export. Runs over labor_logs rows read via the admin client (day_rate_snapshot +
// wht_pct_snapshot present — authenticated sessions can never read either, by
// column grant). daily ช่าง only: own crew are salaried, out of scope.
// gross = Σ (day fraction × per-row gross rate snapshot), the same rule as spec 68
// cost.ts. Spec 314: each row also freezes the firm WHT % at log time
// (wht_pct_snapshot); wht = round2(gross × pct/100) computed PER ROW (a mid-period
// %-change keeps each worked day on its own frozen %), net = gross − wht; a null
// snapshot means 0% (no withholding). The current-state filter (supersede
// anti-join + tombstone, ADR 0009/0015) runs here so callers pass raw rows.
// Pure — no UI, no I/O. Money is rendered only on the PM payroll surfaces
// (requireRole-gated). ADR 0062: a ช่าง binds on workers.user_id (the payee), so payroll rolls
// up per worker — there is no contractor grouping.

import { round2 } from "@/lib/format";
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
  | "wht_pct_snapshot"
  | "superseded_by"
  | "work_date"
  | "work_package_id"
>;

// gross = the firm's labor cost (Σ day-fraction × gross rate snapshot).
// wht = withholding-at-source remitted for the worker. net = worker take-home.
export interface WorkerPay {
  workerId: string;
  name: string;
  days: number;
  gross: number;
  wht: number;
  net: number;
}

export interface PayrollReport {
  workers: WorkerPay[];
  totalDays: number;
  totalGross: number;
  totalWht: number;
  totalNet: number;
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

export function aggregatePayroll(
  rows: ReadonlyArray<PayrollInputRow>,
  opts?: { workPackageIds?: ReadonlySet<string> },
): PayrollReport {
  // Filter to current state across ALL pay types FIRST, then keep daily-pay
  // (daily ช่าง): a supersede correction re-snapshots pay_type, so a DB-level type
  // filter could drop a superseding row and miscount the stale one (spec 69).
  const daily = currentRows(rows).filter((r) => r.pay_type_snapshot === "daily");

  // Spec 309 — project scope. Keep only rows on the given work packages, applied
  // HERE (after the current-state + daily pass) for the SAME reason as the
  // pay-type filter above: a supersede correction can re-snapshot work_package_id
  // onto a different project, so a DB-level WP filter could drop a superseding row
  // and leave the stale one uncancelled. undefined set = all projects.
  const current = opts?.workPackageIds
    ? daily.filter((r) => opts.workPackageIds!.has(r.work_package_id))
    : daily;

  // worker_id -> rolled-up pay line (the worker is the payee, ADR 0062).
  const byWorker = new Map<string, WorkerPay>();
  let totalDays = 0;
  let totalGross = 0;
  let totalWht = 0;
  let totalNet = 0;

  for (const r of current) {
    const days = fractionDays(r.day_fraction as DayFraction);
    // Round per row so each worked day carries its own frozen % (a mid-period
    // %-change never restates an earlier day); the line + grand totals are the
    // sums of these already-rounded rows.
    const gross = round2(days * r.day_rate_snapshot);
    const wht = round2((gross * (r.wht_pct_snapshot ?? 0)) / 100);
    const net = round2(gross - wht);

    const line = byWorker.get(r.worker_id);
    if (line) {
      line.days += days;
      line.gross += gross;
      line.wht += wht;
      line.net += net;
    } else {
      byWorker.set(r.worker_id, {
        workerId: r.worker_id,
        name: r.worker_name_snapshot,
        days,
        gross,
        wht,
        net,
      });
    }

    totalDays += days;
    totalGross += gross;
    totalWht += wht;
    totalNet += net;
  }

  const workers = Array.from(byWorker.values()).sort((a, b) => a.name.localeCompare(b.name, "th"));

  return { workers, totalDays, totalGross, totalWht, totalNet, workerCount: workers.length };
}

// RFC 4180: quote a field that contains a quote, comma, or newline; double
// any internal quote.
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// Export-format contract (pinned by the labor-payroll test); the on-screen labels
// live in labels.ts (PAYROLL_WHT_LABEL / PAYROLL_NET_LABEL) — kept separate so a
// UI copy change never silently reshapes the CSV columns downstream consumers read.
const CSV_HEADER = ["ช่าง", "จำนวนวัน", "ค่าแรง (บาท)", "หัก ณ ที่จ่าย", "สุทธิ"];

export function payrollToCsv(report: PayrollReport, _range: PayrollRange): string {
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const w of report.workers) {
    lines.push(
      [
        csvCell(w.name),
        String(w.days),
        w.gross.toFixed(2),
        w.wht.toFixed(2),
        w.net.toFixed(2),
      ].join(","),
    );
  }
  lines.push(
    [
      "รวม",
      String(report.totalDays),
      report.totalGross.toFixed(2),
      report.totalWht.toFixed(2),
      report.totalNet.toFixed(2),
    ].join(","),
  );
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
