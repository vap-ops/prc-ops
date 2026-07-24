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
import type { MusterWp } from "./wp-groups";

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
  // Spec 357 U-B — the same lead's latest prior muster-day WP set, filtered to
  // still-incomplete leaves. The picker seeds from it when the team has no
  // assignment yet; nothing persists until the SA saves (pre-fill, not truth).
  prefillWpIds: string[];
  // Spec 357 U-C — ยังไม่มา: the lead's live crew members (spec 330 rosters)
  // who have not checked in anywhere today, in active-roster order.
  missing: { id: string; name: string }[];
}
export interface MusterWorker {
  id: string;
  name: string;
}
// The picker types + the pure grouping fold live in a client-safe module (wp-groups)
// so the "use client" cockpit can import groupMusterWps as a value — this file is
// server-only. Re-exported for existing type imports off load-muster.
export type { MusterWp, MusterWpGroup } from "./wp-groups";

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
  // Spec 357 U-B — per lead, the WP ids of their latest PRIOR muster team.
  priorTeamWps?: { leadWorkerId: string; wpIds: string[] }[];
  // Spec 357 U-C — per lead, the LIVE members of the crews they lead (a lead
  // with several active crews contributes several rows; the fold unions them).
  crewRosters?: { leadWorkerId: string; workerIds: string[] }[];
}): MusterBoard {
  const nameById = new Map(raw.workers.map((w) => [w.id, w.name]));
  const nameOf = (id: string) => nameById.get(id) ?? "—";
  // Prefill = prior set ∩ current leaves that are still incomplete. Both filters
  // matter: a completed WP must not re-seed, and an id that stopped being a
  // leaf (regrouped) has no checkbox to uncheck.
  const incompleteLeafIds = new Set(
    raw.wps.filter((w) => w.status !== "complete").map((w) => w.id),
  );
  const priorByLead = new Map((raw.priorTeamWps ?? []).map((p) => [p.leadWorkerId, p.wpIds]));
  // Spec 357 U-C — union each lead's crews; missing subtracts EVERYONE checked
  // in today across all teams (a crew member mustered elsewhere is present).
  const crewByLead = new Map<string, Set<string>>();
  for (const r of raw.crewRosters ?? []) {
    const set = crewByLead.get(r.leadWorkerId) ?? new Set<string>();
    for (const id of r.workerIds) set.add(id);
    crewByLead.set(r.leadWorkerId, set);
  }
  const musteredAnywhere = new Set(raw.attendance.map((a) => a.worker_id));

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
    prefillWpIds: (priorByLead.get(t.lead_worker_id) ?? []).filter((id) =>
      incompleteLeafIds.has(id),
    ),
    // Roster order (raw.workers is name-ordered); ids off the roster drop out
    // (deactivated / foreign workers have no name to render anyway).
    missing: (() => {
      const crew = crewByLead.get(t.lead_worker_id);
      if (!crew) return [];
      return raw.workers
        .filter((w) => crew.has(w.id) && !musteredAnywhere.has(w.id))
        .map((w) => ({ id: w.id, name: w.name }));
    })(),
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

  const [attendanceRes, teamWpsRes, workersRes, leafRes, parentRes, closureRes] = await Promise.all(
    [
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
      // Spec 306 grain-coverage — teams assign per LEAF (งานย่อย) WP so the close-day
      // derive can bind labor_logs (the DB forbids binding to a group งาน WP —
      // wp_reject_group_binding). The QUERY fetches ALL leaves with their status;
      // the incomplete-only offer is applied per team in the picker (pickerWps,
      // spec 357 U-B) so an assigned WP stays visible/removable after completing,
      // and chips/prune keep resolving every leaf.
      supabase
        .from("work_packages")
        .select("id, code, name, parent_id, status")
        .eq("project_id", projectId)
        .eq("is_group", false)
        .order("code"),
      // All the project's WPs (id → code/name), the lookup for a leaf's parent งาน
      // header. Not filtered to is_group so a leaf whose parent is not flagged as a
      // group still resolves to a real header instead of a blank one.
      supabase.from("work_packages").select("id, code, name").eq("project_id", projectId),
      supabase
        .from("muster_day_closures")
        .select("closed_at")
        .eq("project_id", projectId)
        .eq("work_date", date)
        .maybeSingle(),
    ],
  );

  // Enrich each leaf with its parent งาน identity so the picker can group by it.
  const parentById = new Map((parentRes.data ?? []).map((p) => [p.id, p]));
  const wps: MusterWp[] = (leafRes.data ?? []).map((w) => {
    const parent = w.parent_id ? parentById.get(w.parent_id) : null;
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      status: w.status,
      parentId: w.parent_id ?? null,
      parentCode: parent?.code ?? null,
      parentName: parent?.name ?? null,
    };
  });

  // Spec 357 U-B — each lead's latest PRIOR muster team → its WP set (the
  // picker's carry-over seed). One limit-1 query per lead (a board has a
  // handful of teams; PostgREST has no distinct-on), then one wps fetch.
  const leads = [...new Set((teams ?? []).map((t) => t.lead_worker_id))];
  const priorTeams = await Promise.all(
    leads.map(async (lead) => {
      const { data } = await supabase
        .from("muster_teams")
        .select("id, lead_worker_id")
        .eq("project_id", projectId)
        .eq("lead_worker_id", lead)
        .lt("work_date", date)
        .order("work_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }),
  );
  const priorList = priorTeams.filter((t): t is NonNullable<typeof t> => t !== null);
  const priorWpsRes = priorList.length
    ? await supabase
        .from("muster_team_wps")
        .select("team_id, work_package_id")
        .in(
          "team_id",
          priorList.map((t) => t.id),
        )
    : { data: [] as RawTeamWp[] };
  const priorTeamWps = priorList.map((t) => ({
    leadWorkerId: t.lead_worker_id,
    wpIds: (priorWpsRes.data ?? []).filter((x) => x.team_id === t.id).map((x) => x.work_package_id),
  }));

  // Spec 357 U-C — the expected roster: live crew members of the crews today's
  // leads run (spec 330; RLS already admits the SA — sa_visible_crew_ids). Two
  // reads: active crews for the leads, then their live members.
  const { data: crews } = leads.length
    ? await supabase
        .from("crews")
        .select("id, lead_worker_id")
        .eq("project_id", projectId)
        .eq("active", true)
        .in("lead_worker_id", leads)
    : { data: [] as { id: string; lead_worker_id: string | null }[] };
  const crewIds = (crews ?? []).map((c) => c.id);
  const { data: crewMembers } = crewIds.length
    ? await supabase
        .from("crew_members")
        .select("crew_id, worker_id")
        .in("crew_id", crewIds)
        .is("removed_at", null)
    : { data: [] as { crew_id: string; worker_id: string }[] };
  const crewRosters = (crews ?? [])
    .filter((c): c is { id: string; lead_worker_id: string } => c.lead_worker_id !== null)
    .map((c) => ({
      leadWorkerId: c.lead_worker_id,
      workerIds: (crewMembers ?? []).filter((m) => m.crew_id === c.id).map((m) => m.worker_id),
    }));

  return shapeMusterBoard({
    teams: teams ?? [],
    attendance: attendanceRes.data ?? [],
    teamWps: teamWpsRes.data ?? [],
    workers: workersRes.data ?? [],
    wps,
    closure: closureRes.data ?? null,
    priorTeamWps,
    crewRosters,
  });
}
