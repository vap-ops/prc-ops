// Spec 358 U4 — ประวัติการเช็คชื่อ CSV export, the payroll hand-off.
//
// Gate is ATTENDANCE_AUDIT_ROLES — the SAME set as the page and the RPC's own
// inner allowlist. All three must match: a role that can see the report must be
// able to export exactly what it sees, and no other role may reach either (the
// /payroll export/page gate-parity precedent, spec 187's affordance-then-refuse
// bug being the counter-example).
//
// Reads through `audit_attendance_detail` on the RLS SESSION client with
// p_worker_id => null, so the RPC's role gate AND its can_see_project scoping (for
// project_manager) apply to the file exactly as they do to the screen. Never the
// admin client: an export must not be able to widen what its viewer may read.
//
// Raw scan truth only — no baht (see attendance-csv.ts).

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { ATTENDANCE_AUDIT_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { attendanceRange, loadAttendanceDetail } from "@/lib/muster/attendance-audit";
import { attendanceCsvFilename, toAttendanceCsv } from "@/lib/muster/attendance-csv";

export async function GET(request: NextRequest) {
  await requireRole(ATTENDANCE_AUDIT_ROLES);

  const { searchParams } = request.nextUrl;
  // Same parser as the page, so the file and the screen can never disagree about
  // which range was asked for — and an invalid ?start/?project falls back here too
  // rather than reaching SQL as a 22008/22P02.
  // getAll, not get: `get()` returns the FIRST of a repeated key while the page's
  // parser treats a repeated key as ABSENT (the spec-337 lesson). With `get()` a
  // hand-edited ?start=1900-01-01&start=2026-07-01 gave the file a different range
  // from the screen — so the shared parser is fed the same shape it sees there.
  const param = (key: string): string | string[] | undefined => {
    const all = searchParams.getAll(key);
    return all.length === 1 ? all[0] : all.length === 0 ? undefined : all;
  };
  const range = attendanceRange(
    { start: param("start"), end: param("end"), project: param("project") },
    bangkokTodayIso(),
  );

  const supabase = await createServerClient();
  // p_worker_id null = every worker in scope (the page passes one id for its drill).
  const rows = await loadAttendanceDetail(supabase, range, null);
  const csv = toAttendanceCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${attendanceCsvFilename(range)}"`,
      // An audit export is always live, never a cached body.
      "Cache-Control": "no-store",
    },
  });
}
