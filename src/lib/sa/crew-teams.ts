// Spec 279 U7b — shape the /sa/crew crew (team) grouping. Given the three
// RLS-scoped reads the page holds — the active workers on the SA's projects
// (name-ordered), the active crews on those projects, and the active crew_members
// rows — group them into what CrewTeamRoster renders: each crew with its lead
// name + members, and the workers not on any crew. Pure: RLS did the scoping;
// this only groups what it is handed, preserving the worker order it is given.

import type { CrewTeamData, CrewTeamMember } from "@/components/features/sa/crew-team-roster";
import type { WorkerLevel } from "@/lib/nova/dials";

interface WorkerRow {
  id: string;
  name: string;
  level: WorkerLevel | null;
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

const toTeamMember = (w: WorkerRow): CrewTeamMember => ({
  id: w.id,
  name: w.name,
  level: w.level,
});

export function buildCrewTeams(
  workers: WorkerRow[],
  crews: CrewRow[],
  members: CrewMemberRow[],
): CrewTeamData {
  const crewIdByWorker = new Map(members.map((m) => [m.worker_id, m.crew_id]));
  const workerById = new Map(workers.map((w) => [w.id, w]));

  const teams = crews.map((c) => ({
    id: c.id,
    name: c.name,
    // The lead is a bound worker id → render its name; null if it can't be
    // resolved in the visible set (no lead, or an inactive/off-project lead).
    leadName: c.lead_worker_id ? (workerById.get(c.lead_worker_id)?.name ?? null) : null,
    // Filter the name-ordered workers by membership so member order follows the
    // roster order, not the arbitrary crew_members insert order.
    members: workers.filter((w) => crewIdByWorker.get(w.id) === c.id).map(toTeamMember),
  }));

  // A worker is "on a team" if they are a member OR the lead of a crew — a lead
  // without a member row must not show up as loose/unassigned.
  const assigned = new Set<string>(members.map((m) => m.worker_id));
  for (const c of crews) if (c.lead_worker_id) assigned.add(c.lead_worker_id);

  const unassigned = workers.filter((w) => !assigned.has(w.id)).map(toTeamMember);

  return { teams, unassigned };
}
