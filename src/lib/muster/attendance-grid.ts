// Spec 400 U1 — the pure view-model behind ตารางเช็คชื่อ, the worker × day grid.
//
// WHY A GRID AT ALL. The list view (spec 358) builds one row per worker FROM
// `muster_attendance` rows, so it is structurally blind to absence: a worker who
// was never scanned has no row, and a day almost nobody was scanned on
// contributes `+1` to a few totals and is named nowhere. Measured 2026-08-06:
// 11 of 41 active workers had ZERO July rows, and headcount ran 13·17·18·17·1·
// 24·22·23 across 24–31 Jul — the `1` is the finding, and the list cannot say it.
//
// GRAIN is the DATE, not the session: spec 351 lets a date carry a regular AND an
// OT row, and this surface renders one cell per date. That is the same choice
// `buildAttendanceMonth` (spec 374) made for the per-worker calendar, with the
// same merge rule — earliest in, latest out, OT summed. The two cannot share a
// function (that one is month-anchored and labor_logs-coupled) so the shared RULE
// is pinned by a parity test in attendance-grid.test.ts, not by this comment.
// Deliberately NOT `attendance-sessions.ts`: spec 388 keeps sessions apart on
// purpose for the ช่าง's own list, and says so in its own header.
//
// PROJECT-DAY FACTS LIVE ON THE COLUMN. Headcount and closure are identical for
// every worker of a day, so putting them in a cell would report ONE missed ปิดวัน
// as N findings against N people — the correction spec 358 U2 already made for
// the list, and it costs 41× more in a grid.
//
// Pure: no client, no fetching, no Thai copy. Wording lives in the view, which
// reuses `dayClosureLabel` / `openSessionLabel` so the two surfaces cannot drift.

import type { AttendanceDetailRow } from "@/lib/muster/attendance-audit";

/**
 * The widest range the grid will render. `?start`/`?end` are validated for
 * calendar validity but not for SPAN, so `?start=2020-01-01` is reachable and
 * would otherwise emit ~2,400 columns — a render hang from a URL. A quarter is
 * comfortably past the month the report defaults to.
 */
export const MAX_GRID_DAYS = 92;

export interface GridHoliday {
  holiday_date: string;
  name_th: string;
}

/**
 * `?view=` → which shape the report renders. The GRID is the default (spec 400
 * §1: the list cannot express absence), and anything unrecognised falls back to
 * it rather than 404-ing a bookmarked URL. A repeated key arrives as an array
 * and is treated as absent, the same rule `attendanceRange` applies.
 */
export function attendanceView(
  value: string | string[] | undefined,
  opts: { workerRequested?: boolean } = {},
): "grid" | "list" {
  if (value === "list") return "list";
  // A `?worker=` URL predates this unit — every drill link, bookmark and history
  // entry the report has ever minted carries one and no ?view. Defaulting those
  // to the grid would silently drop the drill the URL exists to open, so an
  // explicit worker means the LIST unless ?view says otherwise.
  if (value === undefined && opts.workerRequested) return "list";
  return "grid";
}

/**
 * Spec 400 D9 — where a worker's name in the grid should point, per ROLE.
 *
 * `WORKER_ROSTER_ROLES` (the spec-374 calendar's own gate) is NARROWER than
 * `ATTENDANCE_AUDIT_ROLES`: accounting, hr and project_coordinator read this
 * report and would meet a redirect at that page. They get this report's own
 * drill instead — so the affordance is re-aimed, never withheld.
 *
 * Pure and exported because the branch is the whole point: inside the page it
 * was only reachable through a closure, and a source scan proved the fallback
 * EXISTED while a mutation that made it unreachable stayed green (`if (true)`
 * leaves both the code and the role-set count untouched).
 */
export function gridWorkerHref(opts: {
  workerId: string;
  /** `WORKER_ROSTER_ROLES.includes(role)` — resolved by the page. */
  canOpenCalendar: boolean;
  range: { from: string; to: string; projectId?: string };
  /** The report's own back-referrer, threaded so the drill returns correctly. */
  backHref: string;
}): string {
  const { workerId, canOpenCalendar, range, backHref } = opts;
  // The report's own URL, so the calendar's back chip returns to the range and
  // the referrer the reader actually came from — `safeBackHref` accepts a query
  // string (it rejects only protocol-relative, scheme, backslash and control
  // chars), so this round-trips intact.
  const selfHref = (() => {
    const q = new URLSearchParams({ start: range.from, end: range.to });
    if (range.projectId) q.set("project", range.projectId);
    if (backHref !== "/team") q.set("from", backHref);
    return `/team/attendance?${q.toString()}`;
  })();
  if (canOpenCalendar) {
    // `m=` is load-bearing: the spec-374 calendar anchors on the CURRENT month
    // when it is absent, so a checker auditing July would click a name and land
    // on August — the report's range silently discarded at the click.
    const q = new URLSearchParams({ m: range.from.slice(0, 7), from: selfHref });
    return `/workers/${workerId}/attendance?${q.toString()}`;
  }
  const q = new URLSearchParams({
    start: range.from,
    end: range.to,
    view: "list",
    worker: workerId,
  });
  if (range.projectId) q.set("project", range.projectId);
  if (backHref !== "/team") q.set("from", backHref);
  return `/team/attendance?${q.toString()}#w-${workerId}`;
}

export interface GridDay {
  date: string;
  /** Sunday or a `public_holidays` date. An empty column here is NOT a finding —
   *  without this the grid flags 41 cells every week and teaches the reader to
   *  ignore it (the spec-341 / 358 U2 always-amber failure). */
  nonWorking: boolean;
  /** Named only for a real holiday; a Sunday is non-working with no name. */
  holidayName: string | null;
  /** DISTINCT workers scanned that day — the fact that makes a thin day visible. */
  headcount: number;
  /** `null` when the day carries no rows at all, so "nobody was scanned" is
   *  never rendered as "the day is open". */
  dayClosed: boolean | null;
}

export interface GridCell {
  /** Bangkok wall clock of the EARLIEST check-in of the date. */
  inTime: string | null;
  /** …and the LATEST check-out that EXISTS. A day whose regular session closed
   *  and whose OT session did not still renders a time here — and `openOut`
   *  beside it. The two are not alternatives; read them together. */
  outTime: string | null;
  otHours: number;
  /** ANY session of the date was entered by hand rather than scanned. Same
   *  reading as `openOut`, and for the same reason: a QR regular check-in must
   *  not hide a typed OT one. */
  manualIn: boolean;
  /** ANY session of the date was never checked out — not merely the last one.
   *  A regular session that closed cleanly must not hide an OT one that did
   *  not; that gap is 23 of 67 August sessions. */
  openOut: boolean;
  /** ANY session of the date was closed by `close_muster_day` rather than by a
   *  human — again the same reading, so a manual regular check-out cannot hide
   *  an auto-closed OT session. */
  autoOut: boolean;
  /** The check-out this cell DISPLAYS landed on a later calendar day. Tied to
   *  the displayed time on purpose: it explains that time, it is not a finding
   *  about some other session. */
  outNextDay: boolean;
}

export interface GridRow {
  workerId: string;
  workerName: string;
  /** Sparse by design: a date with no cell is a date the worker was not scanned. */
  cells: Record<string, GridCell>;
  daysPresent: number;
  otHoursTotal: number;
}

export interface AttendanceGridInput {
  from: string;
  to: string;
  rows: readonly AttendanceDetailRow[];
  holidays?: readonly GridHoliday[];
}

export interface AttendanceGrid {
  days: GridDay[];
  rows: GridRow[];
  /** The range exceeds MAX_GRID_DAYS; the view refuses and names the cap. */
  tooWide: boolean;
}

const DAY_MS = 86_400_000;

/** Date-only ISO → UTC ms. The house convention (calendar-grid.ts): Bangkok has
 *  no DST, so date math on the UTC instant of midnight is exact. */
function utcMs(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00Z`);
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Sunday is the site's non-working day; Saturday is a working day here. */
function isSunday(dateIso: string): boolean {
  return new Date(utcMs(dateIso)).getUTCDay() === 0;
}

export function buildAttendanceGrid(input: AttendanceGridInput): AttendanceGrid {
  // No `todayIso`: this builder owns FACTS, the view owns the day-aware WORDING
  // (openSessionLabel / dayClosureLabel). A required input the function cannot
  // use is a contract that drifts.
  const { from, to, rows } = input;

  const startMs = utcMs(from);
  const endMs = utcMs(to);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return { days: [], rows: [], tooWide: false };
  }
  const span = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (span > MAX_GRID_DAYS) return { days: [], rows: [], tooWide: true };

  const holidayByDate = new Map<string, string>();
  for (const h of input.holidays ?? []) holidayByDate.set(h.holiday_date, h.name_th);

  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) dates.push(isoAt(ms));
  const inRange = new Set(dates);

  // ── per-day facts ────────────────────────────────────────────────────────
  const workersByDate = new Map<string, Set<string>>();
  // `every`, mirroring groupDetailByDate: closure is ONE project-day fact, so on
  // real data the reducers agree — but `every` fails CLOSED if that invariant
  // ever breaks, the safe direction for a "this day is settled" claim.
  const closedByDate = new Map<string, boolean>();

  // ── per-(worker, date) cells ─────────────────────────────────────────────
  const rowByWorker = new Map<string, GridRow>();
  const earliestIn = new Map<string, number>();
  const latestOut = new Map<string, number>();
  const key = (workerId: string, date: string) => `${workerId}|${date}`;

  for (const r of rows) {
    if (!inRange.has(r.workDate)) continue;

    let seen = workersByDate.get(r.workDate);
    if (!seen) workersByDate.set(r.workDate, (seen = new Set()));
    seen.add(r.workerId);
    const closed = closedByDate.get(r.workDate);
    closedByDate.set(r.workDate, closed === undefined ? r.dayClosed : closed && r.dayClosed);

    let gridRow = rowByWorker.get(r.workerId);
    if (!gridRow) {
      gridRow = {
        workerId: r.workerId,
        workerName: r.workerName,
        cells: {},
        daysPresent: 0,
        otHoursTotal: 0,
      };
      rowByWorker.set(r.workerId, gridRow);
    }

    let cell = gridRow.cells[r.workDate];
    if (!cell) {
      cell = {
        inTime: null,
        outTime: null,
        otHours: 0,
        manualIn: false,
        openOut: false,
        autoOut: false,
        outNextDay: false,
      };
      gridRow.cells[r.workDate] = cell;
      gridRow.daysPresent += 1;
    }

    cell.otHours += r.otHours ?? 0;
    gridRow.otHoursTotal += r.otHours ?? 0;
    // All three findings read the same way: ANY session of the date, never
    // merely the one whose TIME the cell happens to display. A QR regular
    // check-in must not hide a typed OT one, and a hand check-out must not hide
    // an auto-closed session — the argument that produced `openOut` applies
    // verbatim to the other two, and reading them off the earliest/latest
    // session was an inconsistency a review caught.
    if (r.outAt === null) cell.openOut = true;
    if (r.inMethod === "manual") cell.manualIn = true;
    if (r.outAuto) cell.autoOut = true;

    const cellKey = key(r.workerId, r.workDate);
    const inMs = Date.parse(r.inAt);
    const bestIn = earliestIn.get(cellKey);
    if (!Number.isNaN(inMs) && (bestIn === undefined || inMs < bestIn)) {
      earliestIn.set(cellKey, inMs);
      cell.inTime = r.inTime;
    }
    if (r.outAt !== null) {
      const outMs = Date.parse(r.outAt);
      const bestOut = latestOut.get(cellKey);
      if (!Number.isNaN(outMs) && (bestOut === undefined || outMs > bestOut)) {
        latestOut.set(cellKey, outMs);
        cell.outTime = r.outTime;
        // Stays tied to the DISPLAYED check-out: it explains that time rather
        // than reporting a finding about a different session.
        cell.outNextDay = r.outNextDay;
      }
    }
  }

  const days: GridDay[] = dates.map((date) => {
    const holidayName = holidayByDate.get(date) ?? null;
    return {
      date,
      nonWorking: holidayName !== null || isSunday(date),
      holidayName,
      headcount: workersByDate.get(date)?.size ?? 0,
      dayClosed: closedByDate.get(date) ?? null,
    };
  });

  // Alphabetical by Thai collation. Ranking by "most findings" is deliberately
  // NOT the default — spec §6 keeps it open until the distribution is measured
  // (the spec-375 trap: a rank over a column that barely varies).
  const gridRows = [...rowByWorker.values()].sort((a, b) =>
    a.workerName.localeCompare(b.workerName, "th"),
  );

  return { days, rows: gridRows, tooWide: false };
}
