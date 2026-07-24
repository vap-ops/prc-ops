import "server-only";

// Spec 306 U3 — the muster cockpit reader. Loads today's teams for a project with
// their members (attendance = presence + scan times) and WP sets, plus the active
// worker list (lead picker + manual tap-add) and the project's main WPs (chip
// options). All reads are on the RLS session client: the muster_* tables are
// select-only scoped `can_see_project` for authenticated (spec 306 U2), and the
// SA reads their own project's workers + WPs the same way the badge sheet does.
//
// shapeMusterBoard is the pure fold (unit-tested); loadMusterBoard is the thin
// fetch. Names resolve off the workers list — a referenced id not in it (an
// inactive worker with attendance) falls back to "—" rather than throwing.

import type { createClient } from "@/lib/db/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Spec 351 U2 — the OT session folded onto a member. `ot` is null when the worker
// has no OT that day; otHours is the OT span (regular sessions never carry OT).
export interface MusterOtSession {
  inAt: string | null;
  outAt: string | null;
  otHours: number | null;
}
export interface MusterMember {
  workerId: string;
  name: string;
  // The REGULAR session (08:00–17:00).
  inAt: string | null;
  outAt: string | null;
  outAuto: boolean;
  // The OT session (17:30–whenever), or null.
  ot: MusterOtSession | null;
}
export interface MusterTeam {
  id: string;
  leadWorkerId: string;
  leadName: string;
  members: MusterMember[];
  wpIds: string[];
}
export interface MusterWorker {
  id: string;
  name: string;
}
export interface MusterWp {
  id: string;
  code: string;
  name: string;
}
export interface MusterBoard {
  teams: MusterTeam[];
  workers: MusterWorker[];
  wps: MusterWp[];
  // Spec 306 U4 — the day's closure (ปิดวัน), null while the day is still open.
  closure: { closedAt: string } | null;
}

interface RawTeam {
  id: string;
  lead_worker_id: string;
}
interface RawAttendance {
  team_id: string;
  worker_id: string;
  session: "regular" | "ot";
  in_at: string | null;
  out_at: string | null;
  ot_hours: number | null;
  out_auto?: boolean;
}
interface RawTeamWp {
  team_id: string;
  work_package_id: string;
}

export function shapeMusterBoard(raw: {
  teams: RawTeam[];
  attendance: RawAttendance[];
  teamWps: RawTeamWp[];
  workers: MusterWorker[];
  wps: MusterWp[];
  closure?: { closed_at: string } | null;
}): MusterBoard {
  const nameById = new Map(raw.workers.map((w) => [w.id, w.name]));
  const nameOf = (id: string) => nameById.get(id) ?? "—";

  const teams: MusterTeam[] = raw.teams.map((t) => ({
    id: t.id,
    leadWorkerId: t.lead_worker_id,
    leadName: nameOf(t.lead_worker_id),
    // Spec 351 U2 — a worker now has up to TWO attendance rows (regular + ot);
    // fold them into ONE member (regular fields on the base, ot under `member.ot`).
    // Map insertion order preserves first-seen worker order.
    members: (() => {
      const byWorker = new Map<string, { reg?: RawAttendance; ot?: RawAttendance }>();
      for (const a of raw.attendance.filter((x) => x.team_id === t.id)) {
        const entry = byWorker.get(a.worker_id) ?? {};
        if (a.session === "ot") entry.ot = a;
        else entry.reg = a;
        byWorker.set(a.worker_id, entry);
      }
      return [...byWorker.entries()].map(([workerId, { reg, ot }]) => ({
        workerId,
        name: nameOf(workerId),
        inAt: reg?.in_at ?? null,
        outAt: reg?.out_at ?? null,
        outAuto: reg?.out_auto ?? false,
        ot: ot ? { inAt: ot.in_at, outAt: ot.out_at, otHours: ot.ot_hours } : null,
      }));
    })(),
    wpIds: raw.teamWps.filter((x) => x.team_id === t.id).map((x) => x.work_package_id),
  }));

  return {
    teams,
    workers: raw.workers,
    wps: raw.wps,
    closure: raw.closure ? { closedAt: raw.closure.closed_at } : null,
  };
}

export async function loadMusterBoard(
  supabase: ServerClient,
  projectId: string,
  date: string,
): Promise<MusterBoard> {
  const { data: teams } = await supabase
    .from("muster_teams")
    .select("id, lead_worker_id")
    .eq("project_id", projectId)
    .eq("work_date", date);
  const teamIds = (teams ?? []).map((t) => t.id);

  const [attendanceRes, teamWpsRes, workersRes, wpsRes, closureRes] = await Promise.all([
    teamIds.length
      ? supabase
          .from("muster_attendance")
          .select("team_id, worker_id, session, in_at, out_at, ot_hours, out_auto")
          .in("team_id", teamIds)
      : Promise.resolve({ data: [] as RawAttendance[] }),
    teamIds.length
      ? supabase.from("muster_team_wps").select("team_id, work_package_id").in("team_id", teamIds)
      : Promise.resolve({ data: [] as RawTeamWp[] }),
    supabase
      .from("workers")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("active", true)
      .order("name"),
    // Main WPs only — teams assign per main WP (parent_id IS NULL); sub-WPs inherit
    // the team (spec 306 main-WP grain rule).
    supabase
      .from("work_packages")
      .select("id, code, name")
      .eq("project_id", projectId)
      .is("parent_id", null)
      .order("code"),
    supabase
      .from("muster_day_closures")
      .select("closed_at")
      .eq("project_id", projectId)
      .eq("work_date", date)
      .maybeSingle(),
  ]);

  return shapeMusterBoard({
    teams: teams ?? [],
    attendance: attendanceRes.data ?? [],
    teamWps: teamWpsRes.data ?? [],
    workers: workersRes.data ?? [],
    wps: wpsRes.data ?? [],
    closure: closureRes.data ?? null,
  });
}
