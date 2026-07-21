// Spec 279 U7b + U6 — shape the /sa/crew crew (team) view from the RLS-scoped
// reads the page holds. Groups the roster by crew (each crew with its lead +
// members, plus the workers on no crew — U7b) and, per U6, attaches to each crew:
//   • its members' employment_type (ประจำ/ชั่วคราว), carried straight through, and
//   • the งานย่อย the crew is scheduled on, derived from the แผนพรุ่งนี้ boards: a
//     งาน belongs to a crew when any of its roster (members ∪ lead) appears in that
//     งาน's daily_work_plan_crew.
// Pure: the RLS scoping, the plan date window, and the category resolution are the
// page's job; this only groups + derives from what it is handed, preserving the
// worker order given.

import type {
  CrewTeamData,
  CrewTeamMember,
  CrewWorkPackage,
} from "@/components/features/sa/crew-team-roster";
import type { WorkerLevel } from "@/lib/nova/dials";
import type { EmploymentType } from "@/lib/workers/employment";

interface WorkerRow {
  id: string;
  name: string;
  level: WorkerLevel | null;
  employmentType: EmploymentType;
}
interface CrewRow {
  id: string;
  name: string;
  lead_worker_id: string | null;
}
interface CrewMemberRow {
  crew_id: string;
  worker_id: string;
}
interface PlanItemRow {
  id: string;
  work_package_id: string;
}
interface PlanCrewRow {
  item_id: string;
  worker_id: string;
}

const toTeamMember = (w: WorkerRow): CrewTeamMember => ({
  id: w.id,
  name: w.name,
  level: w.level,
  employmentType: w.employmentType,
});

/** The ONE "assigned" rule (spec 334 review fix): a worker is on a team if they
 * are a member OR the lead of a crew — a lead without a member row must not show
 * up as loose/unassigned. Exported so the /team hub's ยังไม่จัดทีม bubble counts
 * with the same rule this file's roster grouping renders with. */
export function assignedWorkerIdSet(
  members: ReadonlyArray<{ worker_id: string }>,
  crews: ReadonlyArray<{ lead_worker_id: string | null }>,
): Set<string> {
  const assigned = new Set<string>(members.map((m) => m.worker_id));
  for (const c of crews) if (c.lead_worker_id) assigned.add(c.lead_worker_id);
  return assigned;
}

export function buildCrewTeams(input: {
  workers: WorkerRow[];
  crews: CrewRow[];
  members: CrewMemberRow[];
  planItems: PlanItemRow[];
  planCrew: PlanCrewRow[];
  workPackages: CrewWorkPackage[];
}): CrewTeamData {
  const { workers, crews, members, planItems, planCrew, workPackages } = input;

  const crewIdByWorker = new Map(members.map((m) => [m.worker_id, m.crew_id]));
  const workerById = new Map(workers.map((w) => [w.id, w]));

  // worker_id → the WP ids they are planned on (item → WP, then crew-row → worker).
  const wpByItem = new Map(planItems.map((i) => [i.id, i.work_package_id]));
  const wpIdsByWorker = new Map<string, Set<string>>();
  for (const pc of planCrew) {
    const wpId = wpByItem.get(pc.item_id);
    if (!wpId) continue;
    let set = wpIdsByWorker.get(pc.worker_id);
    if (!set) {
      set = new Set();
      wpIdsByWorker.set(pc.worker_id, set);
    }
    set.add(wpId);
  }
  const wpById = new Map(workPackages.map((wp) => [wp.id, wp]));

  const teams = crews.map((c) => {
    // The crew's roster for งาน-derivation = its member worker ids ∪ its lead.
    const rosterIds = new Set(members.filter((m) => m.crew_id === c.id).map((m) => m.worker_id));
    if (c.lead_worker_id) rosterIds.add(c.lead_worker_id);

    const wpIds = new Set<string>();
    for (const wid of rosterIds) {
      const s = wpIdsByWorker.get(wid);
      if (s) for (const id of s) wpIds.add(id);
    }
    const crewWorkPackages = [...wpIds]
      .map((id) => wpById.get(id))
      .filter((wp): wp is CrewWorkPackage => wp !== undefined)
      .sort((a, b) => a.code.localeCompare(b.code));

    return {
      id: c.id,
      name: c.name,
      // The lead is a bound worker id → render its name; null if it can't be
      // resolved in the visible set (no lead, or an inactive/off-project lead).
      leadName: c.lead_worker_id ? (workerById.get(c.lead_worker_id)?.name ?? null) : null,
      // Filter the name-ordered workers by membership so member order follows the
      // roster order, not the arbitrary crew_members insert order.
      members: workers.filter((w) => crewIdByWorker.get(w.id) === c.id).map(toTeamMember),
      workPackages: crewWorkPackages,
    };
  });

  const assigned = assignedWorkerIdSet(members, crews);

  const unassigned = workers.filter((w) => !assigned.has(w.id)).map(toTeamMember);

  return { teams, unassigned };
}
