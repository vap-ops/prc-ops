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
  /**
   * Spec 404 U2 — the day's own project id, from the same embedded
   * `muster_teams` row the name comes from. REQUIRED rather than optional: the
   * `?fix=` panel's writes act on it, and a producer that silently omitted it
   * would degrade to the month-level fallback with nothing failing.
   */
  project_id: string | null;
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
  /** Spec 404 U2 — set together with `projectName`, from the SAME row, so the
   *  `?fix=` panel can never act on a project the cell does not display. Null on
   *  a paid-only cell: `labor_logs` names no muster team. */
  projectId: string | null;
  paidFraction: number;
}

/**
 * Spec 404 U1 — one entry per project the MONTH actually contains.
 *
 * The day owns the project (`muster_teams.project_id` travels with every
 * attendance row); `workers.project_id` is only where the person is assigned
 * NOW and is overwritten by a move, so it can never describe a past month.
 */
export interface AttendanceProjectDays {
  /** The label as loaded, `"<code> <name>"`. */
  label: string;
  /** Spec 404 U2 — the project's id, so the `?fix=` panel can resolve a project
   *  for an EMPTY day of an unambiguous month (`fixPanelProjectId`). */
  projectId: string | null;
  /** First token of the label — the project code. */
  code: string;
  /**
   * The code with the prefix SHARED BY THIS MONTH'S CODES removed, for the
   * cell badge's ~60px box. Equals `code` whenever the month holds one project
   * or the codes share no separator-aligned prefix.
   */
  shortCode: string;
  /** Distinct scanned dates attributed to this project. */
  days: number;
  otHours: number;
}

export interface AttendanceMonthSummary {
  daysScanned: number;
  otHoursTotal: number;
  /** daysScanned × dayRate; null when the worker has no rate recorded. */
  estimatedGross: number | null;
  paidDaysTotal: number;
  /** daysScanned − paidDaysTotal. */
  varianceDays: number;
  /**
   * Ordered by days descending, then code — the header renders it directly.
   * `length > 1` is THE split-month test; nothing may re-derive it by
   * comparing a day against the worker's current assignment, which inverts
   * the moment that assignment changes.
   *
   * A scanned date whose rows carry no project name is counted in
   * `daysScanned` and attributed to nothing, so the entries can sum to LESS
   * than `daysScanned`. That is honest: the alternative invents an owner.
   */
  projectDays: AttendanceProjectDays[];
}

export interface AttendanceMonth {
  grid: MonthGrid;
  cells: Record<string, AttendanceDayCell>;
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

/**
 * Spec 404 U1 — the prefix every code in `codes` shares, truncated to the last
 * separator inside it.
 *
 * ⚠️ The separator cut is the whole point. A raw common prefix of
 * `PRC-2026-004` and `PRC-2026-008` is `PRC-2026-00`, which would leave the
 * badges reading `4` and `8`; and across years the shared part is only `PRC-`,
 * so the year has to survive or `004` could belong to any year. The spec says
 * "strip `PRC-2026-`" because that is true of today's six projects — this
 * derives it instead, so a 2027 project cannot make the badge lie.
 */
function sharedCodePrefix(codes: readonly string[]): string {
  if (codes.length < 2) return "";
  let prefix = codes[0] ?? "";
  for (const code of codes.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < code.length && prefix[i] === code[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix === "") return "";
  }
  const cut = Math.max(prefix.lastIndexOf("-"), prefix.lastIndexOf(" "));
  return cut < 0 ? "" : prefix.slice(0, cut + 1);
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
}): AttendanceMonth {
  const { monthAnchor, dayRate } = opts;
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
        projectId: null,
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
    // Name and id are set TOGETHER, from the same row: a cell that displayed one
    // project while the panel wrote to another would be the U1 badge defect with
    // a wage attached.
    if (!cell.projectName && row.project_name) {
      cell.projectName = row.project_name;
      cell.projectId = row.project_id;
    }
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

  // Attribution is per DATE, through the cell — so a date carrying a regular
  // AND an OT session (spec 351) is one day, exactly as `daysScanned` counts
  // it, and the split can never sum to more than the total it sits under.
  const byLabel = new Map<
    string,
    { label: string; projectId: string | null; days: number; otHours: number }
  >();
  for (const date of scannedDates) {
    const cell = cells[date];
    const label = cell?.projectName;
    if (!cell || !label) continue;
    const entry = byLabel.get(label) ?? { label, projectId: cell.projectId, days: 0, otHours: 0 };
    entry.days += 1;
    entry.otHours += cell.otHours;
    byLabel.set(label, entry);
  }
  const codeOf = (label: string) => label.split(" ")[0] ?? label;
  const prefix = sharedCodePrefix([...byLabel.keys()].map(codeOf));
  const projectDays: AttendanceProjectDays[] = [...byLabel.values()]
    .map((e) => {
      const code = codeOf(e.label);
      const stripped = prefix && code.startsWith(prefix) ? code.slice(prefix.length) : "";
      return { ...e, code, shortCode: stripped === "" ? code : stripped };
    })
    .sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));

  return {
    grid: monthGrid(monthAnchor),
    cells,
    summary: {
      daysScanned,
      otHoursTotal,
      estimatedGross: dayRate === null ? null : daysScanned * dayRate,
      paidDaysTotal,
      varianceDays: daysScanned - paidDaysTotal,
      projectDays,
    },
  };
}
