// Spec 374 U1 — pure view-model for the per-worker attendance calendar.
// Merges muster sessions (spec 351: a date can carry a regular AND an OT row)
// into one cell per date, overlays labor_logs paid days, and derives the
// month summary (scanned days, OT, estimate, scanned-vs-paid variance).
// Bangkok is fixed UTC+7 (no DST) so time-of-day math is plain offset math,
// matching the UTC-ms convention in calendar-grid.ts.

import { monthGrid, type MonthGrid } from "@/lib/work-packages/calendar-grid";
import { bangkokDateOf } from "@/lib/dates";
import { formatThaiTime } from "@/lib/i18n/labels";

export interface AttendanceMusterRow {
  work_date: string;
  in_at: string | null;
  out_at: string | null;
  in_method: string | null;
  out_method: string | null;
  out_auto: boolean;
  ot_hours: number;
  project_name: string | null;
}

export interface AttendancePaidRow {
  work_date: string;
  day_fraction: number;
}

export interface LaborLogRow {
  id: string;
  superseded_by: string | null;
  work_date: string;
  day_fraction: "full" | "half" | null;
}

/**
 * labor_logs → paid rows, with the SAME current-state semantics as
 * src/lib/labor/payroll.ts (currentRows + fractionDays): drop rows a newer
 * correction supersedes (ADR 0009 anti-join), drop cancellation rows
 * (null fraction), map full→1 / half→0.5. Duplicated rather than imported so
 * this reader does not touch the payroll danger-path module; the parity is
 * pinned by attendance-month.test.ts. Deliberate difference from the payroll
 * REPORT: no pay_type filter — this counts recorded labor days for monthly
 * ช่าง too (the label reads บันทึกค่าแรงแล้ว, not จ่ายแล้ว).
 */
export function paidRowsFromLaborLogs(rows: ReadonlyArray<LaborLogRow>): AttendancePaidRow[] {
  const superseded = new Set(rows.map((r) => r.superseded_by).filter((v) => v !== null));
  return rows
    .filter((r) => !superseded.has(r.id) && r.day_fraction !== null)
    .map((r) => ({
      work_date: r.work_date,
      day_fraction: r.day_fraction === "full" ? 1 : 0.5,
    }));
}

export interface AttendanceDayCell {
  inTime: string | null;
  outTime: string | null;
  inMethod: string | null;
  outMethod: string | null;
  outAuto: boolean;
  /** The rendered out time falls on the day AFTER work_date (post-midnight
   *  OT check-out) — without this the cell reads as out-before-in. */
  outNextDay: boolean;
  otHours: number;
  projectName: string | null;
  paidFraction: number;
}

export interface AttendanceMonthSummary {
  daysScanned: number;
  otHoursTotal: number;
  /** daysScanned × dayRate; null when the worker has no rate recorded. */
  estimatedGross: number | null;
  paidDaysTotal: number;
  /** daysScanned − paidDaysTotal. */
  varianceDays: number;
}

export interface HolidayRow {
  holiday_date: string;
  name_th: string;
}

export interface AttendanceMonth {
  grid: MonthGrid;
  cells: Record<string, AttendanceDayCell>;
  /** Spec 374 U2 — iso date → holiday name, anchor month only. Display-only
   *  marking (no pay semantics, by operator ruling). */
  holidayByDate: Record<string, string>;
  summary: AttendanceMonthSummary;
}

// One home for wall-clock display: formatThaiTime (Intl, Asia/Bangkok, h23)
// — the same formatter the sibling /team/attendance drill uses for this field.
function bangkokHm(ts: string | null): string | null {
  if (!ts) return null;
  if (Number.isNaN(Date.parse(ts))) return null;
  return formatThaiTime(ts);
}

function sameMonth(dateIso: string, anchorIso: string): boolean {
  return dateIso.slice(0, 7) === anchorIso.slice(0, 7);
}

const MONTH_PARAM = /^(20\d{2})-(0[1-9]|1[0-2])$/;

/**
 * ?m= → a safe YYYY-MM-01 anchor. First value of a repeated param; years
 * outside 2000–2099 (and anything malformed) fall back to the current
 * Bangkok month — an unclamped year reaches the DB as an expanded-year ISO
 * string (22007 → 500) or renders a mislabeled 1900s grid.
 */
export function resolveMonthAnchor(m: string | string[] | undefined, todayIso: string): string {
  const first = Array.isArray(m) ? m[0] : m;
  if (first !== undefined && MONTH_PARAM.test(first)) return `${first}-01`;
  return `${todayIso.slice(0, 7)}-01`;
}

export function buildAttendanceMonth(opts: {
  /** First day of the month being rendered, YYYY-MM-01. */
  monthAnchor: string;
  musterRows: AttendanceMusterRow[];
  paidRows: AttendancePaidRow[];
  dayRate: number | null;
  holidays?: HolidayRow[];
}): AttendanceMonth {
  const { monthAnchor, dayRate } = opts;
  const holidayByDate: Record<string, string> = {};
  for (const h of opts.holidays ?? []) {
    if (sameMonth(h.holiday_date, monthAnchor)) holidayByDate[h.holiday_date] = h.name_th;
  }
  const musterRows = opts.musterRows.filter((r) => sameMonth(r.work_date, monthAnchor));
  const paidRows = opts.paidRows.filter((r) => sameMonth(r.work_date, monthAnchor));

  const cells: Record<string, AttendanceDayCell> = {};
  const cellFor = (date: string): AttendanceDayCell => {
    let cell = cells[date];
    if (!cell) {
      cell = {
        inTime: null,
        outTime: null,
        inMethod: null,
        outMethod: null,
        outAuto: false,
        outNextDay: false,
        otHours: 0,
        projectName: null,
        paidFraction: 0,
      };
      cells[date] = cell;
    }
    return cell;
  };

  // Merge sessions per date: earliest in wins, latest out wins, OT sums.
  const earliestIn = new Map<string, number>();
  const latestOut = new Map<string, number>();
  for (const row of musterRows) {
    const cell = cellFor(row.work_date);
    if (row.in_at) {
      const ms = Date.parse(row.in_at);
      const best = earliestIn.get(row.work_date);
      if (!Number.isNaN(ms) && (best === undefined || ms < best)) {
        earliestIn.set(row.work_date, ms);
        cell.inTime = bangkokHm(row.in_at);
        cell.inMethod = row.in_method;
      }
    }
    if (row.out_at) {
      const ms = Date.parse(row.out_at);
      const best = latestOut.get(row.work_date);
      if (!Number.isNaN(ms) && (best === undefined || ms > best)) {
        latestOut.set(row.work_date, ms);
        cell.outTime = bangkokHm(row.out_at);
        cell.outMethod = row.out_method;
        cell.outAuto = row.out_auto;
        cell.outNextDay = bangkokDateOf(row.out_at) > row.work_date;
      }
    }
    cell.otHours += row.ot_hours;
    if (!cell.projectName && row.project_name) cell.projectName = row.project_name;
  }

  let paidDaysTotal = 0;
  for (const row of paidRows) {
    const cell = cellFor(row.work_date);
    cell.paidFraction += row.day_fraction;
    paidDaysTotal += row.day_fraction;
  }

  const scannedDates = new Set(musterRows.map((r) => r.work_date));
  const daysScanned = scannedDates.size;
  const otHoursTotal = musterRows.reduce((sum, r) => sum + r.ot_hours, 0);

  return {
    grid: monthGrid(monthAnchor),
    cells,
    holidayByDate,
    summary: {
      daysScanned,
      otHoursTotal,
      estimatedGross: dayRate === null ? null : daysScanned * dayRate,
      paidDaysTotal,
      varianceDays: daysScanned - paidDaysTotal,
    },
  };
}
