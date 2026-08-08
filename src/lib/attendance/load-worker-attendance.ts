// Spec 374 U1 — loader for the per-worker attendance calendar.
// Admin-client seam, same authorization model as /workers and /payroll: the
// page's requireRole(WORKER_ROSTER_ROLES) gate is what authorizes these reads
// — workers.day_rate has no authenticated grant, muster_attendance RLS is
// can_see_project-scoped (plain procurement fails it), and labor_logs has no
// authenticated SELECT at all, so the RLS client would return nothing useful
// for exactly the audience this page serves. (public_holidays alone is
// authenticated-readable reference data; it rides the same client so the
// month loads on one connection, not because it needs the seam.)
import "server-only";

import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { addMonthsIso } from "@/lib/work-packages/calendar-grid";
import { grossRate } from "@/lib/labor/gross-rate";
import { WORKER_LEVEL_LABEL } from "@/lib/nova/dials";
import { PAY_TYPE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/auth/role-home";
import type { AttendanceWorkerHeader } from "@/components/features/labor/worker-attendance-calendar";
import {
  paidRowsFromLaborLogs,
  type AttendanceMusterRow,
  type AttendancePaidRow,
  type HolidayRow,
} from "@/lib/attendance/attendance-month";
import { canSeeStandardRate } from "@/lib/attendance/std-rate-audience";
import { viewerSeesAllMusterProjects } from "@/lib/attendance/muster-scope";

export interface WorkerAttendancePayload {
  worker: AttendanceWorkerHeader;
  musterRows: AttendanceMusterRow[];
  paidRows: AttendancePaidRow[];
  /** Spec 374 U2 — the month's public holidays (display-only marking). */
  holidays: HolidayRow[];
  /** Standard gross rate for the worker's level — null unless the viewer is in
   *  the labor-rates money audience AND the worker has a level AND the level
   *  has a configured standard. */
  stdRate: number | null;
}

/**
 * Spec 404 U2b — DISTINCT workers scanned per date, for ONE project, across one
 * month. It is the `headcount` half of the grid's gap-cell rule
 * (`calendarBlankDayFixable`), which is what decides whether a day this worker
 * missed becomes a door.
 *
 * ⚖️ **It widens nobody's scope.** The caller passes the project resolved from
 * THIS worker's own muster rows, which `loadWorkerAttendance` has already
 * filtered to the viewer's memberships for any role outside
 * `viewerSeesAllMusterProjects` — so a project reaching this function is one the
 * viewer was already shown days from. The admin seam is the same one the month
 * read uses and for the same reason (`muster_attendance` RLS is
 * can_see_project-scoped and plain `procurement` fails it).
 *
 * Selected at worker grain rather than aggregated because PostgREST cannot GROUP
 * BY: the payload is two ids per scan (~550 rows for a full month of a 25-person
 * site), and the caller only asks for it when a door could actually be offered —
 * the viewer can correct AND the month names exactly one project.
 */
export async function loadProjectHeadcountByDate(
  projectId: string,
  /** YYYY-MM-01 */
  monthAnchor: string,
): Promise<Record<string, number>> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("muster_attendance")
    .select("work_date, worker_id, muster_teams!inner(project_id)")
    .eq("muster_teams.project_id", projectId)
    .gte("work_date", monthAnchor)
    .lt("work_date", addMonthsIso(monthAnchor, 1));
  if (error) throw new Error(`attendance headcount read failed: ${error.message}`);

  // DISTINCT workers, because spec 351 lets one person carry a regular AND an OT
  // row on the same date — counting rows would report a 4-person day as 5.
  const byDate = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const set = byDate.get(row.work_date) ?? new Set<string>();
    set.add(row.worker_id);
    byDate.set(row.work_date, set);
  }
  return Object.fromEntries([...byDate].map(([date, workers]) => [date, workers.size]));
}

export async function loadWorkerAttendance(
  workerId: string,
  /** YYYY-MM-01 */
  monthAnchor: string,
  viewerRole: UserRole,
  viewerUserId: string,
): Promise<WorkerAttendancePayload | null> {
  const admin = createAdminSupabase();
  const nextAnchor = addMonthsIso(monthAnchor, 1);

  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, name, day_rate, active, phone, pay_type, level, project_id, cost_confirmed_at")
    .eq("id", workerId)
    .maybeSingle();
  if (workerError) throw new Error(`attendance worker read failed: ${workerError.message}`);
  if (!worker) return null;

  // The admin seam exists to unlock plain `procurement` (can_see_project =
  // false). A project_manager stays MEMBERSHIP-scoped, exactly as the muster
  // RLS scopes them — the seam must not widen what a non-member PM can read.
  let musterQuery = admin
    .from("muster_attendance")
    .select(
      "work_date, in_at, out_at, in_method, out_method, out_auto, ot_hours, muster_teams!inner(project_id, projects(code, name))",
    )
    .eq("worker_id", workerId)
    .gte("work_date", monthAnchor)
    .lt("work_date", nextAnchor)
    .order("work_date", { ascending: true });
  if (!viewerSeesAllMusterProjects(viewerRole)) {
    const [memRes, ledRes] = await Promise.all([
      admin.from("project_members").select("project_id").eq("user_id", viewerUserId),
      admin.from("projects").select("id").eq("project_lead_id", viewerUserId),
    ]);
    if (memRes.error || ledRes.error) {
      throw new Error(
        `attendance scope read failed: ${memRes.error?.message ?? ledRes.error?.message}`,
      );
    }
    const allowed = [
      ...new Set([
        ...(memRes.data ?? []).map((r) => r.project_id),
        ...(ledRes.data ?? []).map((r) => r.id),
      ]),
    ];
    // Empty membership must yield zero rows, not an unfiltered read.
    musterQuery = musterQuery.in(
      "muster_teams.project_id",
      allowed.length > 0 ? allowed : ["00000000-0000-0000-0000-000000000000"],
    );
  }

  const [musterRes, laborRes, holidayRes, projectRes, stdRes] = await Promise.all([
    musterQuery,
    admin
      .from("labor_logs")
      .select("id, superseded_by, work_date, day_fraction")
      .eq("worker_id", workerId)
      .gte("work_date", monthAnchor)
      .lt("work_date", nextAnchor),
    admin
      .from("public_holidays")
      .select("holiday_date, name_th")
      .gte("holiday_date", monthAnchor)
      .lt("holiday_date", nextAnchor),
    worker.project_id
      ? admin.from("projects").select("code, name").eq("id", worker.project_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    canSeeStandardRate(viewerRole) && worker.level !== null
      ? Promise.all([
          admin
            .from("worker_level_rates")
            .select("entered_rate, wht_basis")
            .eq("level", worker.level)
            .maybeSingle(),
          admin.from("labor_wht_config").select("wht_pct").eq("id", true).maybeSingle(),
        ])
      : Promise.resolve(null),
  ]);

  if (musterRes.error) throw new Error(`attendance muster read failed: ${musterRes.error.message}`);
  if (laborRes.error) throw new Error(`attendance labor read failed: ${laborRes.error.message}`);
  if (holidayRes.error)
    throw new Error(`attendance holiday read failed: ${holidayRes.error.message}`);
  if (projectRes.error)
    throw new Error(`attendance project read failed: ${projectRes.error.message}`);

  const musterRows: AttendanceMusterRow[] = (musterRes.data ?? []).map((r) => {
    const project = r.muster_teams?.projects ?? null;
    return {
      work_date: r.work_date,
      in_at: r.in_at,
      out_at: r.out_at,
      in_method: r.in_method,
      out_method: r.out_method,
      out_auto: r.out_auto,
      ot_hours: r.ot_hours === null ? 0 : Number(r.ot_hours),
      project_name: project ? `${project.code} ${project.name}` : null,
      // Spec 404 U2 — already in the embedded select since spec 374 (the
      // membership filter targets it); the mapper simply dropped it, which is
      // why U6b's calendar door had to send `projectId: null` and let the fix
      // screen re-infer the project from the session.
      project_id: r.muster_teams?.project_id ?? null,
    };
  });

  const paidRows: AttendancePaidRow[] = paidRowsFromLaborLogs(laborRes.data ?? []);

  let stdRate: number | null = null;
  if (stdRes) {
    const [levelRateRes, whtRes] = stdRes;
    // Fail loud, mirroring /workers: a masked standards read would silently
    // hide the compare for the one audience it exists for.
    if (levelRateRes.error || whtRes.error) {
      throw new Error(
        `attendance standards read failed: ${levelRateRes.error?.message ?? whtRes.error?.message}`,
      );
    }
    const row = levelRateRes.data;
    const whtPctRaw = whtRes.data?.wht_pct;
    stdRate = row
      ? grossRate(
          row.entered_rate === null ? null : Number(row.entered_rate),
          row.wht_basis,
          whtPctRaw === undefined || whtPctRaw === null ? null : Number(whtPctRaw),
        )
      : null;
  }

  return {
    worker: {
      id: worker.id,
      name: worker.name,
      levelLabel: worker.level === null ? null : WORKER_LEVEL_LABEL[worker.level],
      dayRate: worker.day_rate === null ? null : Number(worker.day_rate),
      phone: worker.phone,
      payTypeLabel: PAY_TYPE_LABEL[worker.pay_type],
      active: worker.active,
      costConfirmedAt: worker.cost_confirmed_at,
      projectLabel: projectRes.data ? `${projectRes.data.code} ${projectRes.data.name}` : null,
    },
    musterRows,
    paidRows,
    holidays: holidayRes.data ?? [],
    stdRate,
  };
}
