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
import type { Database } from "@/lib/db/database.types";
import type { MusterWp } from "./wp-groups";
import { shapeUnclosedPriorDays, type UnclosedPriorDay } from "./prior-day-close";

type WorkerGender = Database["public"]["Enums"]["worker_gender"];

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
  // Spec 357 U-F — resolved off the workers roster (null for an id not on it).
  gender: WorkerGender | null;
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
  missing: { id: string; name: string; gender: WorkerGender | null }[];
}
export interface MusterWorker {
  id: string;
  name: string;
  // Spec 357 U-F: เพศ for the cockpit's ช/ญ chip (null = ยังไม่ระบุ). Required
  // on the type so a loader select that forgets the column fails typecheck.
  gender: WorkerGender | null;
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
  // Spec 359 U1 — each worker's most recent muster BEFORE this date. Drives the
  // continuous sweep's team-change warning: the comparison keys on leadWorkerId
  // (display names repeat across the roster), the copy uses leadName. A worker
  // who has never mustered is absent (the sweep renders ครั้งแรก for them).
  priorTeamByWorker: { workerId: string; leadWorkerId: string; leadName: string }[];
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
  // Spec 359 U1 — flat prior-day attendance rows, any order.
  priorAttendance?: { workerId: string; leadWorkerId: string; workDate: string }[];
}): MusterBoard {
  const workerById = new Map(raw.workers.map((w) => [w.id, w]));
  const nameOf = (id: string) => workerById.get(id)?.name ?? "—";
  const genderOf = (id: string) => workerById.get(id)?.gender ?? null;
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
        gender: genderOf(workerId),
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
        .map((w) => ({ id: w.id, name: w.name, gender: w.gender }));
    })(),
  }));

  // Spec 359 U1 — latest prior muster per worker. Compared by ISO date string,
  // which sorts lexicographically. The lead resolves to a NAME here so the client
  // reducer never has to hold an id→name map for leads who are not on today's
  // board; the ID travels with it because that is what the comparison keys on.
  const latestPrior = new Map<string, { leadWorkerId: string; workDate: string }>();
  for (const row of raw.priorAttendance ?? []) {
    const seen = latestPrior.get(row.workerId);
    if (!seen || row.workDate > seen.workDate) {
      latestPrior.set(row.workerId, { leadWorkerId: row.leadWorkerId, workDate: row.workDate });
    }
  }

  return {
    teams,
    workers: raw.workers,
    wps: raw.wps,
    closure: raw.closure ? { closedAt: raw.closure.closed_at } : null,
    priorTeamByWorker: [...latestPrior.entries()].map(([workerId, v]) => ({
      workerId,
      leadWorkerId: v.leadWorkerId,
      leadName: nameOf(v.leadWorkerId),
    })),
  };
}

export async function loadMusterBoard(
  supabase: ServerClient,
  projectId: string,
  date: string,
): Promise<MusterBoard> {
  // Spec 397 U4 — CREW only. This board groups by lead_worker_id, and an office
  // team is deliberately leadless, so an unfiltered read would render a headless
  // group where the หัวหน้าชุด belongs. The office team has its own surface (U5).
  const { data: rawTeams } = await supabase
    .from("muster_teams")
    .select("id, lead_worker_id")
    .eq("project_id", projectId)
    .eq("work_date", date)
    .eq("kind", "crew");
  // Spec 397 U4 made `lead_worker_id` nullable for the office kind, so the
  // generated type widened for every read. A crew team ALWAYS has a lead —
  // `muster_teams_crew_has_lead` enforces it in the database — so this narrows
  // rather than casts: the filter is unreachable for crew rows, and if the CHECK
  // is ever weakened the board drops the headless row instead of rendering it.
  const teams = (rawTeams ?? []).flatMap((t) =>
    t.lead_worker_id === null ? [] : [{ id: t.id, lead_worker_id: t.lead_worker_id }],
  );
  const teamIds = teams.map((t) => t.id);

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
        .select("id, name, gender")
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
  // Spec 397 U4 — no kind filter needed below: this reads the prior team OF A
  // LEAD, and an office team is leadless, so `eq(lead_worker_id, …)` can never
  // match one. Left unfiltered deliberately, pinned in office-team-kind.test.ts.
  const leads = [...new Set(teams.map((t) => t.lead_worker_id))];
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
  // Narrow the lead here too — this list is keyed BY lead downstream. These rows
  // were fetched with `eq("lead_worker_id", lead)` on a non-null lead, so the
  // null arm is unreachable; it exists because the column's type widened in U4.
  const priorList = priorTeams.flatMap((t) =>
    t === null || t.lead_worker_id === null ? [] : [{ id: t.id, lead_worker_id: t.lead_worker_id }],
  );
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

  // Spec 359 U1 — prior muster rows for this project, so the continuous sweep can
  // warn when a worker turns up in a different line from last time. Two reads
  // because PostgREST cannot join: the prior teams, then their attendance.
  //
  // Unbounded backwards, matching loadUnclosedPriorDays: a date window would make
  // a worker returning after a long gap indistinguishable from a first-timer and
  // silently mislabel them ครั้งแรก. Rows are three small columns and only exist
  // for days a team was actually opened, so the read stays modest; if a project
  // ever accumulates years of muster this is the query to revisit.
  // Spec 397 U4 — CREW only: these prior rows seed the crew suggestions, and an
  // office attendee must never be suggested into a ช่าง crew.
  const { data: priorTeamRows } = await supabase
    .from("muster_teams")
    .select("id, lead_worker_id, work_date")
    .eq("project_id", projectId)
    .lt("work_date", date)
    .eq("kind", "crew");
  // Same narrowing as the day's board above, and for the same reason: crew rows
  // always carry a lead (`muster_teams_crew_has_lead`), but the generated type
  // widened when the office kind made the column nullable.
  const priorTeamById = new Map(
    (priorTeamRows ?? []).flatMap((t) =>
      t.lead_worker_id === null
        ? []
        : [[t.id, { id: t.id, lead_worker_id: t.lead_worker_id, work_date: t.work_date }] as const],
    ),
  );
  const priorAttendanceRes = priorTeamById.size
    ? await supabase
        .from("muster_attendance")
        .select("team_id, worker_id")
        .in("team_id", [...priorTeamById.keys()])
        .eq("session", "regular")
    : { data: [] as { team_id: string; worker_id: string }[] };
  const priorAttendance = (priorAttendanceRes.data ?? []).flatMap((a) => {
    const t = priorTeamById.get(a.team_id);
    return t
      ? [{ workerId: a.worker_id, leadWorkerId: t.lead_worker_id, workDate: t.work_date }]
      : [];
  });

  return shapeMusterBoard({
    teams: teams ?? [],
    attendance: attendanceRes.data ?? [],
    teamWps: teamWpsRes.data ?? [],
    workers: workersRes.data ?? [],
    wps,
    closure: closureRes.data ?? null,
    priorTeamWps,
    crewRosters,
    priorAttendance,
  });
}

// Spec 306 close-day carryover — the days BEFORE `date` on which this project
// mustered but nobody ever pressed ปิดวัน. Same RLS session client as the board:
// all three muster_* tables are SELECT-scoped `can_see_project` with no date
// predicate (verified live), so a prior day reads exactly like today's.
//
// Unbounded backwards on purpose — see the note in prior-day-close.ts: a cap
// makes an old day permanently unbookable, because closing is the only way to
// produce the closure row the wage derive keys off. The banner bounds what it
// RENDERS instead. Rows are two small columns and only days a team was actually
// opened on exist, so the read stays modest; if a project ever accumulates years
// of muster this is the query to revisit.
//
// FAILS CLOSED. Unlike the board's reads, a swallowed error here is not
// harmless: if only the CLOSURES query fails, every prior day looks unclosed and
// the SA is invited to re-close days that were already closed — and a re-close
// re-runs derive_muster_labor, re-snapshotting wages. A missing banner is the
// status quo and returns on the next load; a false banner causes writes.
export async function loadUnclosedPriorDays(
  supabase: ServerClient,
  projectId: string,
  date: string,
): Promise<UnclosedPriorDay[]> {
  const [teamsRes, closuresRes] = await Promise.all([
    supabase
      .from("muster_teams")
      .select("id, work_date")
      .eq("project_id", projectId)
      .lt("work_date", date),
    supabase
      .from("muster_day_closures")
      .select("work_date")
      .eq("project_id", projectId)
      .lt("work_date", date),
  ]);
  if (teamsRes.error || closuresRes.error) return [];
  const priorTeams = teamsRes.data ?? [];
  const closedDates = (closuresRes.data ?? []).map((c) => c.work_date);
  if (priorTeams.length === 0) return [];

  // Only the still-open days need their sessions read (for the OT disclosure on
  // the close confirmation) — a closed day is off the banner either way. Narrowed
  // to OPEN OT rows: that is all the fold counts, and on live data it turns a
  // 14-row fetch into 0. The fold re-checks the same conditions as defence in
  // depth — it is a public pure function, not an accomplice to this query.
  const closed = new Set(closedDates);
  const openTeamIds = priorTeams.filter((t) => !closed.has(t.work_date)).map((t) => t.id);
  const attendanceRes = openTeamIds.length
    ? await supabase
        .from("muster_attendance")
        .select("team_id, session, in_at, out_at")
        .in("team_id", openTeamIds)
        .eq("session", "ot")
        .is("out_at", null)
        .not("in_at", "is", null)
    : { data: [], error: null };
  if (attendanceRes.error) return [];

  return shapeUnclosedPriorDays({
    priorTeams,
    closedDates,
    attendance: attendanceRes.data ?? [],
    today: date,
  });
}
