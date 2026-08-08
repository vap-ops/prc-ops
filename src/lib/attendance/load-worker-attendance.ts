// Spec 374 U1 — loader for the per-worker attendance calendar.
// Admin-client seam, same authorization model as /workers and /payroll: the
// page's requireRole(WORKER_ROSTER_ROLES) gate is what authorizes these reads
// — workers.day_rate has no authenticated grant, muster_attendance RLS is
// can_see_project-scoped (plain procurement fails it), and labor_logs has no
// authenticated SELECT at all, so the RLS client would return nothing useful
// for exactly the audience this page serves.
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
} from "@/lib/attendance/attendance-month";
import { canSeeStandardRate } from "@/lib/attendance/std-rate-audience";
import { viewerSeesAllMusterProjects } from "@/lib/attendance/muster-scope";

export interface WorkerAttendancePayload {
  worker: AttendanceWorkerHeader;
  musterRows: AttendanceMusterRow[];
  paidRows: AttendancePaidRow[];
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
 * BY, and the caller only asks for it when a door could actually be offered —
 * the viewer can correct AND the month names exactly one project.
 *
 * ⚠️ **PAGED, because this read can cross PostgREST's `db-max-rows = 1000`.** A
 * 25-person site is ~550 rows for a month, which reads as comfortable and is one
 * growth step from the cap (40 workers × 26 days is 1,040, and spec 351's OT rows
 * add more). Past it PostgREST silently returns an ARBITRARY 1,000-row window, so
 * headcounts would under-report and doors would appear and vanish between two
 * identical page loads — a truncation that fails closed, silently and
 * non-deterministically. The explicit `order` is what makes each page's window
 * defined rather than arbitrary; the loop is the repo's existing pattern.
 */
const PAGE = 1000;

export async function loadProjectHeadcountByDate(
  projectId: string,
  /** YYYY-MM-01 */
  monthAnchor: string,
): Promise<Record<string, number>> {
  const admin = createAdminSupabase();
  // DISTINCT workers, because spec 351 lets one person carry a regular AND an OT
  // row on the same date — counting rows would report a 4-person day as 5.
  const byDate = new Map<string, Set<string>>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("muster_attendance")
      .select("work_date, worker_id, muster_teams!inner(project_id)")
      .eq("muster_teams.project_id", projectId)
      .gte("work_date", monthAnchor)
      .lt("work_date", addMonthsIso(monthAnchor, 1))
      .order("work_date", { ascending: true })
      .order("worker_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`attendance headcount read failed: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      const set = byDate.get(row.work_date) ?? new Set<string>();
      set.add(row.worker_id);
      byDate.set(row.work_date, set);
    }
    if (rows.length < PAGE) break;
  }
  return Object.fromEntries([...byDate].map(([date, workers]) => [date, workers.size]));
}

/**
 * Spec 404 U2b — every date in the month on which THIS worker has a muster row,
 * across EVERY project, membership-free.
 *
 * ⚠️ It exists to WITHHOLD doors, never to show anything, and that is what makes
 * the membership-free read acceptable: no date it returns is rendered, named or
 * counted anywhere — it only subtracts candidates.
 *
 * The hole it closes is a real offer-then-refuse, and it is the write-affordance
 * face of the disclosure gap spec 404 §5 (U3) still owns. `loadWorkerAttendance`
 * scopes muster to the viewer's memberships for any role outside
 * `viewerSeesAllMusterProjects` — and `project_manager` is both in
 * `WORKER_ROSTER_ROLES` and in `MUSTER_CORRECT_ROLES`. So for a PM who is a member
 * of one project only, a day this worker spent at ANOTHER project renders BLANK,
 * the month still names exactly one project, and the headcount rule would offer a
 * door on it. Submitting the add reaches `muster_correct_session`, whose existing-
 * row lookup is `worker_id + work_date + session` with NO project predicate
 * (verified against the live definition), so it takes the UPDATE path and refuses
 * with `worker is in another team today — move first`.
 *
 * Without this the unit would turn an undisclosed row into a control that fails on
 * press — the exact class this repo ratchets against.
 */
export async function loadWorkerMusterDates(
  workerId: string,
  /** YYYY-MM-01 */
  monthAnchor: string,
): Promise<Set<string>> {
  const admin = createAdminSupabase();
  // One row per session, so at most ~62 for a month — no paging needed, and a
  // comment rather than a loop because the bound is structural (spec 351 caps a
  // worker at one regular plus one OT session per date).
  const { data, error } = await admin
    .from("muster_attendance")
    .select("work_date")
    .eq("worker_id", workerId)
    .gte("work_date", monthAnchor)
    .lt("work_date", addMonthsIso(monthAnchor, 1));
  if (error) throw new Error(`attendance worker-dates read failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.work_date));
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

  const [musterRes, laborRes, projectRes, stdRes] = await Promise.all([
    musterQuery,
    admin
      .from("labor_logs")
      .select("id, superseded_by, work_date, day_fraction")
      .eq("worker_id", workerId)
      .gte("work_date", monthAnchor)
      .lt("work_date", nextAnchor),
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
    stdRate,
  };
}
