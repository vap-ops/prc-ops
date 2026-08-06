// Spec 358 U2 — the attendance AUDIT read layer for the office/payroll audience.
//
// The two `audit_attendance_*` RPCs (migration 20260813075906, which replaced
// 20260813075853 when spec 397 U1 widened the allowlists) are SECURITY
// DEFINER reads gated on ATTENDANCE_AUDIT_ROLES, because muster_* RLS runs on
// can_see_project — which is FALSE for accounting and hr. They are called on the
// RLS SESSION client (never admin): the RPC is the privileged seam, and calling it
// under the user's JWT is what makes its role gate and its can_see_project scoping
// (for project_manager) actually apply.
//
// RAW scan truth only. No wages, no GL, no baht — the money derive is spec 306 U5.
//
// This module is client-safe on purpose (pure helpers + a client-agnostic reader),
// so the picker/table can import the view-model without dragging server-only code
// into the bundle (the #742 `server-only` build trap).

import { ISO_DATE_REGEX, bangkokDateOf } from "@/lib/dates";
import { formatThaiTime } from "@/lib/i18n/labels";

export type AttendanceRange = { from: string; to: string; projectId?: string };

/** One row of `audit_attendance_summary`, camelCased for the view. */
export type AttendanceSummaryRow = {
  workerId: string;
  workerName: string;
  daysPresent: number;
  otHoursTotal: number;
  projectCount: number;
  manualInCount: number;
  qrInCount: number;
  autoOutCount: number;
  openOutCount: number;
  unclosedDayCount: number;
};

export type SignalChip = { key: string; label: string; count: number };

/** A searchParams value: Next hands back `string | string[] | undefined`. */
type Param = string | string[] | undefined;

function one(value: Param): string | undefined {
  // A repeated key (?from=a&from=b) arrives as an array — treat it as absent
  // rather than silently picking one (the spec-337 repeated-key lesson).
  return typeof value === "string" ? value : undefined;
}

/** `ISO_DATE_REGEX` is SHAPE-only, so 2026-02-30 passes it — and then reaches
 *  SQL, where `between` raises 22008 and the page's error boundary offers only a
 *  reset() that re-renders the SAME bad searchParams: a permanent dead end with
 *  no form on screen to correct it. Require a real calendar date too. */
function isValidIsoDate(raw: string): boolean {
  if (!ISO_DATE_REGEX.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

function isoOr(value: Param, fallback: string): string {
  const raw = one(value);
  return raw !== undefined && isValidIsoDate(raw) ? raw : fallback;
}

/** Same dead-end class for `?project`: a non-uuid reaches SQL as 22P02. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * searchParams → the range the report reads. Defaults to the current Bangkok
 * month through today (an audit never wants future dates), falls back per FIELD
 * so one bad input does not discard a good one, and swaps a reversed range so
 * `from <= to` always holds before it reaches SQL's BETWEEN.
 *
 * The URL params are `?start`/`?end`, NOT `?from`/`?to` — `?from` is reserved
 * repo-wide for the back-referrer that `withBackFrom` writes (the /payroll page
 * renamed its own range params for this exact collision). The returned SHAPE
 * still uses from/to because that is what the RPC's arguments are called.
 */
export function attendanceRange(
  params: { start?: Param; end?: Param; project?: Param },
  todayIso: string,
): AttendanceRange {
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  let from = isoOr(params.start, monthStart);
  let to = isoOr(params.end, todayIso);
  if (from > to) [from, to] = [to, from];

  const project = one(params.project)?.trim();
  return project && UUID_RE.test(project) ? { from, to, projectId: project } : { from, to };
}

/**
 * The audit signals worth a second look, as chips. Only NON-ZERO counts chip —
 * a clean row stays clean so the eye lands on the rows that need scrutiny.
 *
 * `qrInCount` deliberately does NOT chip: a QR scan is the GOOD case (proof the
 * badge was present), so it is not a finding. A fully-manual row instead shows
 * the `manual` chip — which is exactly the pilot's shape (1 of 36 check-ins came
 * from a QR scan), the signal this report exists to surface.
 *
 * `unclosedDayCount` does NOT chip either, and that is a correction, not an
 * omission: whether anyone pressed ปิดวัน is a PROJECT-DAY fact, identical for
 * every worker on that day, so per-worker chips repeated it N times and read as N
 * separate findings against N people. It surfaces ONCE in the header instead.
 *
 * `rangeIncludesToday` softens the open-check-out chip: mid-shift there is no
 * auto-out cron, so every worker on site today legitimately has `out_at IS NULL`.
 * Chipping that as ยังไม่เช็คออก would flag the whole crew every morning and
 * train the auditor to ignore chips — the /settings/integrity lesson (spec 341).
 * Same count, honest wording: ยังอยู่ในงาน while the range reaches today.
 */
export function formatSignals(
  row: AttendanceSummaryRow,
  opts: { rangeIncludesToday?: boolean } = {},
): SignalChip[] {
  const openLabel = opts.rangeIncludesToday ? "ยังอยู่ในงาน" : "ยังไม่เช็คออก";
  const chips: SignalChip[] = [
    { key: "manual", label: `บันทึกมือ ${row.manualInCount}`, count: row.manualInCount },
    { key: "autoOut", label: `ออกอัตโนมัติ ${row.autoOutCount}`, count: row.autoOutCount },
    { key: "openOut", label: `${openLabel} ${row.openOutCount}`, count: row.openOutCount },
  ];
  return chips.filter((chip) => chip.count > 0);
}

/**
 * The project-day facts, surfaced ONCE for the whole report rather than per
 * worker. `unclosedDayCount` is the max across rows, not a sum: every worker of
 * an unclosed project-day carries the same count, so summing would multiply one
 * missed ปิดวัน by the size of the crew.
 */
export function unclosedDaySignal(rows: AttendanceSummaryRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.unclosedDayCount), 0);
}

// ── U3: the per-day drill ────────────────────────────────────────────────────
// Where a summary signal COUNT becomes an inspectable per-session FACT: which
// check-in was manual, which check-out the system wrote, who recorded it.

/** Raw `audit_attendance_detail` row. db:types marks every RETURNS-TABLE column
 *  non-null, but `out_at`/`out_method`/`ot_hours` are nullable columns and
 *  `scanned_by_name`/`team_lead_name` come from LEFT joins — widened here so a
 *  missing users/workers row cannot crash the render (the spec-350 note). */
type RawDetailRow = {
  worker_id: string;
  worker_name: string;
  project_id: string;
  project_name: string;
  work_date: string;
  session: "regular" | "ot";
  in_at: string;
  in_method: "qr" | "manual";
  out_at: string | null;
  out_method: "qr" | "manual" | null;
  out_auto: boolean;
  ot_hours: number | null;
  scanned_by: string;
  scanned_by_name: string | null;
  team_lead_name: string | null;
  day_closed: boolean;
};

export type AttendanceDetailRow = {
  workerId: string;
  workerName: string;
  projectId: string;
  projectName: string;
  workDate: string;
  session: "regular" | "ot";
  inAt: string;
  /** Bangkok wall-clock HH:MM — a UTC render makes an 08:38 check-in read 01:38. */
  inTime: string;
  inMethod: "qr" | "manual";
  outAt: string | null;
  outTime: string | null;
  outMethod: "qr" | "manual" | null;
  outAuto: boolean;
  otHours: number | null;
  scannedBy: string;
  scannedByName: string | null;
  teamLeadName: string | null;
  dayClosed: boolean;
  /** No check-out recorded. Mid-shift that is normal; on a past day it is a gap. */
  stillIn: boolean;
  /**
   * The check-out landed on a LATER Bangkok calendar day than `workDate`. Real for
   * an evening OT session closed after midnight: `out_at` is `now()` with no
   * relation to `work_date` (muster_scan_out), so `22:00 – 01:30` would read as an
   * out-BEFORE-in defect that isn't one, and the ot_hours span would contradict it.
   */
  outNextDay: boolean;
};

export function shapeDetailRow(raw: RawDetailRow): AttendanceDetailRow {
  return {
    workerId: raw.worker_id,
    workerName: raw.worker_name,
    projectId: raw.project_id,
    projectName: raw.project_name,
    workDate: raw.work_date,
    session: raw.session,
    inAt: raw.in_at,
    inTime: formatThaiTime(raw.in_at),
    inMethod: raw.in_method,
    outAt: raw.out_at,
    outTime: raw.out_at ? formatThaiTime(raw.out_at) : null,
    outMethod: raw.out_method,
    outAuto: raw.out_auto,
    otHours: raw.ot_hours === null ? null : Number(raw.ot_hours),
    scannedBy: raw.scanned_by,
    scannedByName: raw.scanned_by_name,
    teamLeadName: raw.team_lead_name,
    dayClosed: raw.day_closed,
    stillIn: raw.out_at === null,
    outNextDay: raw.out_at !== null && bangkokDateOf(raw.out_at) > raw.work_date,
  };
}

/**
 * Validates `?worker` for the drill. Two conditions, both load-bearing: the value
 * must be uuid-SHAPED (a non-uuid reaches SQL as 22P02 and dead-ends on the error
 * boundary, the same class as `?project`), and it must be one of the ids the
 * caller's own summary returned. The RPC already scopes rows by role and
 * membership, so this is defence in depth — but it also means a hand-typed id
 * from outside the caller's scope costs zero round-trips instead of rendering a
 * mysteriously empty drill.
 */
export function attendanceWorkerId(
  value: Param,
  visibleWorkerIds: readonly string[],
): string | null {
  const raw = one(value)?.trim();
  if (!raw || !UUID_RE.test(raw)) return null;
  return visibleWorkerIds.includes(raw) ? raw : null;
}

/**
 * How a session with no check-out should READ. The summary chip softens by RANGE
 * (it has no per-day detail to work with); the drill knows the actual day, so it
 * softens per DAY — strictly more honest, and it stops the two surfaces
 * contradicting each other. Before this, a worker whose chip said ยังอยู่ในงาน
 * expanded into rows that all said ยังไม่เช็คออก — the exact wording the summary
 * had deliberately rejected, and with no way to tell today's normal open session
 * from yesterday's real gap.
 *
 * Spec 400 U1 widened the PARAMETER (not the rule) to the field it actually
 * reads, so the grid — whose cell is a merged DATE, not a session row — calls
 * this same function instead of re-deriving the wording a third time. Every
 * existing caller passes a full row and still type-checks.
 */
export function openSessionLabel(row: { workDate: string }, todayIso: string): string {
  return row.workDate >= todayIso ? "ยังอยู่ในงาน" : "ยังไม่เช็คออก";
}

/** Same split for the day header: an unclosed day is only a FINDING once the day
 *  is over. Today's day is legitimately still open. */
export function dayClosureLabel(
  day: { workDate: string; dayClosed: boolean },
  todayIso: string,
): string {
  if (day.dayClosed) return "ปิดวันแล้ว";
  return day.workDate >= todayIso ? "ยังอยู่ระหว่างวัน" : "ยังไม่ปิดวัน";
}

export type AttendanceDetailDay = {
  workDate: string;
  /** Closure is a project-DAY fact (the U2 correction), so it lives on the day. */
  dayClosed: boolean;
  /**
   * Also a per-DAY fact, not per-session: `muster_scan_in` gates an OT session on
   * a regular session of the SAME team, and `move_muster_worker` moves every
   * session of a date and refuses cross-project — so a worker-day is provably
   * single-project (verified live). Printing it on each session repeated the same
   * name twice on any day with OT.
   */
  projectName: string;
  /**
   * Spec 397 U3 — the reopen form posts (project, date), and the day header is
   * the only place that knows which project-day it is rendering. Same
   * single-project invariant as projectName above.
   */
  projectId: string;
  sessions: AttendanceDetailRow[];
};

/** Newest day first (an auditor starts from the most recent), regular before ot
 *  within a day (the OT session is the exception, so it reads second). */
export function groupDetailByDate(rows: AttendanceDetailRow[]): AttendanceDetailDay[] {
  const byDate = new Map<string, AttendanceDetailRow[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.workDate);
    if (bucket) bucket.push(row);
    else byDate.set(row.workDate, [row]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([workDate, sessions]) => {
      const ordered = [...sessions].sort((a, b) =>
        a.session === b.session ? 0 : a.session === "regular" ? -1 : 1,
      );
      return {
        workDate,
        // `every`, not `some`: closure is one project-day fact shared by all of a
        // day's sessions (single-project invariant above), so the two reducers
        // agree on real data — but `every` fails CLOSED if that ever breaks,
        // which is the safe direction for a "this day is settled" claim.
        dayClosed: ordered.every((s) => s.dayClosed),
        projectName: ordered[0]?.projectName ?? "",
        projectId: ordered[0]?.projectId ?? "",
        sessions: ordered,
      };
    });
}

/** Minimal shape of the Supabase client this reader needs (session client). */
type RpcClient = {
  rpc: (
    fn: "audit_attendance_summary",
    args: { p_from: string; p_to: string; p_project_id?: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Raw RPC row — every column is NOT NULL by construction (counts + coalesced sum). */
type RawSummaryRow = {
  worker_id: string;
  worker_name: string;
  days_present: number;
  ot_hours_total: number;
  project_count: number;
  manual_in_count: number;
  qr_in_count: number;
  auto_out_count: number;
  open_out_count: number;
  unclosed_day_count: number;
};

export function shapeSummaryRow(raw: RawSummaryRow): AttendanceSummaryRow {
  return {
    workerId: raw.worker_id,
    workerName: raw.worker_name,
    daysPresent: raw.days_present,
    otHoursTotal: Number(raw.ot_hours_total),
    projectCount: raw.project_count,
    manualInCount: raw.manual_in_count,
    qrInCount: raw.qr_in_count,
    autoOutCount: raw.auto_out_count,
    openOutCount: raw.open_out_count,
    unclosedDayCount: raw.unclosed_day_count,
  };
}

/**
 * Reads the per-worker summary. Throws on RPC error so the page surfaces a real
 * failure instead of rendering an empty report that looks like "nobody worked".
 */
export async function loadAttendanceSummary(
  client: RpcClient,
  range: AttendanceRange,
): Promise<AttendanceSummaryRow[]> {
  const { data, error } = await client.rpc("audit_attendance_summary", {
    p_from: range.from,
    p_to: range.to,
    ...(range.projectId ? { p_project_id: range.projectId } : {}),
  });
  if (error) throw new Error(`audit_attendance_summary failed: ${error.message}`);
  return ((data ?? []) as RawSummaryRow[]).map(shapeSummaryRow);
}

/** Minimal client shape for the detail read (same session client). */
type DetailRpcClient = {
  rpc: (
    fn: "audit_attendance_detail",
    args: { p_from: string; p_to: string; p_project_id?: string; p_worker_id?: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Reads one worker's per-session rows for the range. Throws on RPC error for the
 * same reason the summary does: an empty drill would read as "this worker was
 * never here", which is a lie an auditor could act on.
 */
export async function loadAttendanceDetail(
  client: DetailRpcClient,
  range: AttendanceRange,
  /** One worker for the page's drill; `null` for EVERY worker in scope (the U4
   *  CSV export). Null is passed through as an omitted arg so the RPC applies its
   *  own default rather than us sending an explicit SQL null. */
  workerId: string | null,
): Promise<AttendanceDetailRow[]> {
  const { data, error } = await client.rpc("audit_attendance_detail", {
    p_from: range.from,
    p_to: range.to,
    ...(range.projectId ? { p_project_id: range.projectId } : {}),
    // `!= null`, not truthiness: an empty string is type-legal here and would
    // silently widen a one-worker drill into EVERY worker.
    ...(workerId != null && workerId !== "" ? { p_worker_id: workerId } : {}),
  });
  if (error) throw new Error(`audit_attendance_detail failed: ${error.message}`);
  return ((data ?? []) as RawDetailRow[]).map(shapeDetailRow);
}
