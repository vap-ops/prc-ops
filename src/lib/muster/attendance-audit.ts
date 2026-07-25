// Spec 358 U2 — the attendance AUDIT read layer for the office/payroll audience.
//
// The two `audit_attendance_*` RPCs (migration 20260813075853) are SECURITY
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

import { ISO_DATE_REGEX } from "@/lib/dates";

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

function isoOr(value: Param, fallback: string): string {
  const raw = one(value);
  return raw !== undefined && ISO_DATE_REGEX.test(raw) ? raw : fallback;
}

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
  return project ? { from, to, projectId: project } : { from, to };
}

/**
 * The audit signals worth a second look, as chips. Only NON-ZERO counts chip —
 * a clean row stays clean so the eye lands on the rows that need scrutiny.
 *
 * `qrInCount` deliberately does NOT chip: a QR scan is the GOOD case (proof the
 * badge was present), so it is not a finding. A fully-manual row instead shows
 * the `manual` chip — which is exactly the live pilot's shape (0 of 22 check-ins
 * came from a QR scan), the signal this report exists to surface.
 */
export function formatSignals(row: AttendanceSummaryRow): SignalChip[] {
  const chips: SignalChip[] = [
    { key: "manual", label: `บันทึกมือ ${row.manualInCount}`, count: row.manualInCount },
    { key: "autoOut", label: `ออกอัตโนมัติ ${row.autoOutCount}`, count: row.autoOutCount },
    { key: "openOut", label: `ยังไม่เช็คออก ${row.openOutCount}`, count: row.openOutCount },
    { key: "unclosed", label: `วันไม่ปิด ${row.unclosedDayCount}`, count: row.unclosedDayCount },
  ];
  return chips.filter((chip) => chip.count > 0);
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
