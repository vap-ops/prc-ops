import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { addPersonControl, type AddPersonControl } from "@/lib/muster/add-person";
import { loadAttendanceDetail, type AttendanceDetailRow } from "@/lib/muster/attendance-audit";
import { canAddMissingSession } from "@/lib/muster/day-fix";
import { loadDayAudit, type DayAuditRow } from "@/lib/muster/day-audit";

/**
 * Spec 400 U7 (§D19) — everything the worker-day fix SCREEN reads, in one place,
 * because two surfaces now render it: the `/team/attendance/fix` route (U6a) and
 * the grid's `?fix=` panel.
 *
 * Extracted rather than copied. The reopen form was copied between the drill and
 * the day panel once and drifted on three separate details before it was pulled
 * into one component; this screen reads five sources with two different clients
 * and a documented reason for each, so a second copy would drift faster.
 *
 * The narrow-ADMIN reads are unchanged and their justifications travel with
 * them — see the comments at each call.
 */

type Db = SupabaseClient<Database>;

export interface WorkerDayFix {
  workerName: string;
  /** Resolved: the `?project=` param, else the first session's project. */
  projectId: string | null;
  projectName: string | null;
  sessions: AttendanceDetailRow[];
  /** `null` when no project could be resolved — a different fact from `false`. */
  dayClosed: boolean | null;
  /** The team a retime must name. `null` when the worker-day has no session. */
  teamId: string | null;
  offersAdd: boolean;
  addState: AddPersonControl | null;
  addTeams: { teamId: string; leadName: string | null; headcount: number }[];
  trail: DayAuditRow[] | null;
}

/** `null` when the worker does not exist — the caller renders ไม่พบช่างคนนี้. */
export async function loadWorkerDayFix(input: {
  supabase: Db;
  admin: Db;
  workerId: string;
  date: string;
  /** The raw `?project=` param, already shape-validated by `parseFixParams`. */
  projectParam: string | null;
  todayIso: string;
}): Promise<WorkerDayFix | null> {
  const { supabase, admin, workerId, date, projectParam, todayIso } = input;

  // The worker's own name, through a NARROW ADMIN read.
  //
  // ⚠️ SESSION-client until spec 400 U6c. `workers` "readable by staff" is
  // role-only over {site_admin, project_manager, procurement, procurement_manager,
  // super_admin, project_director}, so once U6c widened this screen to
  // ATTENDANCE_AUDIT_ROLES, accounting / hr / project_coordinator passed the gate
  // and then read ZERO rows with `error === null` — rendering "ไม่พบช่างคนนี้", a
  // factual claim that a worker the grid just named does not exist.
  //
  // No new exposure: `audit_attendance_detail`, gated on this same audience,
  // already returns `workerName` for every session it discloses.
  //
  // ⚠️ The `error` is read, not discarded: a FAILED read is indistinguishable
  // from a genuinely missing row if only `data` is checked.
  const { data: workerRow, error: workerError } = await admin
    .from("workers")
    .select("id, name")
    .eq("id", workerId)
    .maybeSingle();
  if (workerError) throw new Error(`attendance fix: worker read failed: ${workerError.message}`);
  if (workerRow === null) return null;

  const range = projectParam
    ? { from: date, to: date, projectId: projectParam }
    : { from: date, to: date };
  const sessions = await loadAttendanceDetail(supabase, range, workerId);

  const projectId = projectParam ?? sessions[0]?.projectId ?? null;
  // A no-session worker-day carries no session to read the project's NAME off of.
  //
  // ⚠️ Deliberately still a SESSION-client read after U6c: `can_see_project` is
  // `else false` for accounting and hr, so on a worker-day with NO session those
  // two see the date without the project name. That degrades a LABEL; it does not
  // make a false claim or withhold a control, unlike the worker read above.
  const projectNameFromSession =
    sessions.length === 0 && projectId !== null
      ? ((await supabase.from("projects").select("name").eq("id", projectId).maybeSingle()).data
          ?.name ?? null)
      : null;
  const projectName = sessions[0]?.projectName ?? projectNameFromSession;

  // Day closure. Sessions already carry it. With no session yet,
  // `muster_day_closures` RLS is can_see_project — FALSE for procurement — so a
  // narrow ADMIN lookup on exactly this (project, date) is the only way to answer
  // it for this audience.
  // ⚠️ FAIL CLOSED: an errored read returns `data === null`, byte-identical to
  // "there is no closure row", so branching on `data` alone would render the OPEN
  // state on a day that may in fact be CLOSED.
  let dayClosed: boolean | null = null;
  if (sessions.length > 0) {
    dayClosed = sessions.every((s) => s.dayClosed);
  } else if (projectId !== null) {
    const { data: closure, error: closureError } = await admin
      .from("muster_day_closures")
      .select("work_date")
      .eq("project_id", projectId)
      .eq("work_date", date)
      .maybeSingle();
    if (closureError) {
      throw new Error(`attendance fix: closure read failed: ${closureError.message}`);
    }
    dayClosed = closure !== null;
  }

  // The team id an existing session's retime must supply. `audit_attendance_detail`
  // discloses the team's LEAD NAME but never its id, so this is the same narrow-
  // ADMIN seam as the closure lookup. A worker-day is single-team, so one lookup
  // covers both session rows.
  let teamId: string | null = null;
  if (sessions.length > 0) {
    const { data: teamRow } = await admin
      .from("muster_attendance")
      .select("team_id")
      .eq("worker_id", workerId)
      .eq("work_date", date)
      .limit(1)
      .maybeSingle();
    if (!teamRow) throw new Error("attendance fix: team lookup failed for an existing session");
    teamId = teamRow.team_id;
  }

  // The add arm — only when there is no regular session yet. Teams are fetched
  // only when the form could actually render.
  const offersAdd = canAddMissingSession(sessions);
  const wantsAddTeams = offersAdd && projectId !== null && dayClosed !== true;
  const { data: dayTeams, error: dayTeamsError } = wantsAddTeams
    ? await supabase.rpc("list_muster_teams_for_day", { p_project: projectId, p_date: date })
    : { data: null, error: null };
  if (dayTeamsError) throw new Error(`muster team list failed: ${dayTeamsError.message}`);
  const addTeams = (dayTeams ?? []).map((t) => ({
    teamId: t.team_id,
    leadName: t.lead_name,
    headcount: t.headcount,
  }));
  const addState = offersAdd
    ? addPersonControl({
        date,
        todayIso,
        dayClosed,
        projectId,
        canCorrect: true,
        teamCount: addTeams.length,
      })
    : null;

  // The trail — the SAME `list_muster_day_audit` the day panel reads, filtered to
  // this worker. `null` (not `[]`) when there is no project: the RPC takes exactly
  // one, so a ทุกโครงการ column is never fetched.
  const fullTrail = projectId !== null ? await loadDayAudit(supabase, projectId, date) : null;
  const trail = fullTrail === null ? null : fullTrail.filter((r) => r.workerId === workerId);

  return {
    workerName: workerRow.name,
    projectId,
    projectName,
    sessions,
    dayClosed,
    teamId,
    offersAdd,
    addState,
    addTeams,
    trail,
  };
}
