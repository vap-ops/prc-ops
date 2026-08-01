// Spec 388 U2 — pure view-model for the ช่าง's OWN attendance list.
//
// GRAIN: one row per SESSION, not per day. Its sibling buildAttendanceMonth
// (spec 374) deliberately MERGES a date's sessions into a single cell —
// earliest in, latest out, OT summed — because the procurement calendar renders
// one cell per date. This surface must keep the regular and OT sessions apart,
// because the late verdict applies to the regular session only, so that cell
// model is the wrong shape here. The two share the row shape and the Bangkok
// time formatter; they do not share the builder.
//
// ORDER is the RPC's, not this module's: get_my_attendance() emits
// work_date DESC, in_at ASC — days newest first, but a day's sessions in the
// order they actually happened. Re-sorting here would silently undo that.
//
// THE LATE RULE (spec 388 §3, operator-decided 2026-08-01). There is no
// start_time or shift column anywhere in the schema, so "late" is a rule this
// module introduces rather than a fact the database holds. It was derived from
// the live distribution of 131 real regular check-ins, in Asia/Bangkok wall
// clock: 07:38–07:59 (64) · 08:00–08:12 (61) · EMPTY 08:13–08:26 · 08:27–08:32
// (4) · EMPTY · 09:08 (2). The cut sits dead centre of that empty interval.
// 08:00 sharp would have marked 66 of 131 — half the workforce, including the
// ordinary morning — which is the 99%-fire-rate defect spec 375 rejected.
//
// ⚠️ THE UNIT IS MINUTES-OF-DAY IN ASIA/BANGKOK. Comparing a raw timestamptz
// string, or reading the UTC clock, is the failure mode: Bangkok is UTC+7, so
// 08:15 local is 01:15Z. Everything here goes through Intl with the zone pinned.

import { formatThaiTime } from "@/lib/i18n/labels";
import { bangkokDateOf } from "@/lib/dates";

/** 08:00 Asia/Bangkok, as minutes since Bangkok midnight. */
export const WORK_START_MINUTES = 8 * 60;
/** The grace the operator granted on top of the start time. */
export const LATE_GRACE_MINUTES = 15;
/** สาย from 08:15 Bangkok. Derived in the header comment, not chosen by taste. */
export const LATE_CUTOFF_MINUTES = WORK_START_MINUTES + LATE_GRACE_MINUTES;
/** How far back the ช่าง's list reaches, inclusive of the boundary day. */
export const ATTENDANCE_WINDOW_DAYS = 30;

/** A row as get_my_attendance() returns it. */
export interface AttendanceSessionInput {
  work_date: string;
  session: string;
  in_at: string | null;
  in_method: string | null;
  out_at: string | null;
  out_method: string | null;
  out_auto: boolean;
  ot_hours: number;
  project_name: string | null;
}

/**
 * `none` is a first-class answer, not a missing value: an OT session, a
 * manually-entered row and a row with no check-in each legitimately carry no
 * verdict, and the UI must render that difference rather than defaulting to
 * "on time" (which would quietly absolve) or to "late" (which would quietly
 * accuse).
 */
export type AttendanceVerdict = "on_time" | "late" | "none";

export interface AttendanceSessionRow {
  workDate: string;
  session: string;
  /** Bangkok wall clock HH:MM, via the same formatter the calendar uses. */
  inTime: string | null;
  outTime: string | null;
  /** The check-out falls on the day AFTER work_date (post-midnight OT). */
  outNextDay: boolean;
  outAuto: boolean;
  inMethod: string | null;
  otHours: number;
  projectName: string | null;
  verdict: AttendanceVerdict;
}

export interface AttendanceSessionsSummary {
  daysRecorded: number;
  onTime: number;
  late: number;
  otSessions: number;
  otHoursTotal: number;
}

export interface AttendanceSessions {
  rows: AttendanceSessionRow[];
  summary: AttendanceSessionsSummary;
}

const BANGKOK_HM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since Bangkok midnight, or null when the timestamp is unusable. */
function bangkokMinutesOfDay(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = BANGKOK_HM.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

function verdictFor(row: AttendanceSessionInput): AttendanceVerdict {
  // No OT start rule exists, so an OT session cannot be late against anything.
  if (row.session !== "regular") return "none";
  // A manual row's timestamp is the SA's tap, not the ช่าง's arrival. Telling a
  // worker they were late on someone else's clock is the thing this refuses.
  if (row.in_method !== "qr") return "none";
  if (!row.in_at) return "none";
  const minutes = bangkokMinutesOfDay(row.in_at);
  if (minutes === null) return "none";
  return minutes >= LATE_CUTOFF_MINUTES ? "late" : "on_time";
}

/** `todayIso` is passed in rather than read from the clock so the window is testable. */
function windowStart(todayIso: string): string {
  const ms = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(ms)) return todayIso;
  const start = new Date(ms - ATTENDANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

export function buildAttendanceSessions(opts: {
  rows: ReadonlyArray<AttendanceSessionInput>;
  todayIso: string;
}): AttendanceSessions {
  const from = windowStart(opts.todayIso);
  // ISO dates compare correctly as strings; both sides are YYYY-MM-DD.
  const inWindow = opts.rows.filter((r) => r.work_date >= from);

  const rows: AttendanceSessionRow[] = inWindow.map((r) => ({
    workDate: r.work_date,
    session: r.session,
    inTime: r.in_at ? formatThaiTime(r.in_at) : null,
    outTime: r.out_at ? formatThaiTime(r.out_at) : null,
    outNextDay: r.out_at ? bangkokDateOf(r.out_at) > r.work_date : false,
    outAuto: r.out_auto,
    inMethod: r.in_method,
    otHours: r.ot_hours,
    projectName: r.project_name,
    verdict: verdictFor(r),
  }));

  return {
    rows,
    summary: {
      // Distinct DAYS, so a date carrying both a regular and an OT session
      // counts once — the ช่าง worked one day, not two.
      daysRecorded: new Set(rows.map((r) => r.workDate)).size,
      onTime: rows.filter((r) => r.verdict === "on_time").length,
      late: rows.filter((r) => r.verdict === "late").length,
      otSessions: rows.filter((r) => r.session !== "regular").length,
      otHoursTotal: rows.reduce((sum, r) => sum + r.otHours, 0),
    },
  };
}
