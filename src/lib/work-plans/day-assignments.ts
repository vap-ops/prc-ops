// Spec 330 U6 — pure grouping of one day's plan items onto the team map.
//
// The daily plan stores per-item WORKER sets (ADR 0076 — deliberately no team
// FK), so team chips are DERIVED: an item appears on a crew card when its
// workers overlap that crew's active members. `mixed` marks an item whose
// workers are NOT a subset of the team — an SA hand-tuned it person-by-person
// on /sa/plan, and the map's team-grain writes are locked out for it (the map
// must never clobber worker-grain knowledge).
//
// Lives in src/lib/work-plans/ (a READ-ONLY view helper over the daily-plan
// tables): NOT in src/lib/team-map/, which is danger-held for the crew
// mutation relays — this module writes nothing.

import type { TeamMapTeamCard } from "@/lib/team-map/build-team-map";

export interface DayPlanWpItem {
  itemId: string;
  workPackageId: string;
  code: string;
  name: string;
  /** Current daily_work_plan_crew worker ids for the item (may be empty). */
  workerIds: ReadonlyArray<string>;
}

export interface TeamDayAssignment {
  item: DayPlanWpItem;
  /**
   * True when the item's worker set is not a subset of this team's members —
   * team-grain ย้าย/เอาออก are locked out on it (spec 330 §12).
   */
  mixed: boolean;
}

/** One day's board as the team page loads it: the date writes will target. */
export interface TeamMapDayPlan {
  /** ISO date (Bangkok) — the exact value passed to the plan RPC actions. */
  date: string;
  items: DayPlanWpItem[];
}

export interface DayAssignments {
  /** Items with ZERO workers — safe to place on a team (the tray). */
  tray: DayPlanWpItem[];
  /** crewId → that card's chips. Crew cards only — never firm/pool. */
  byTeam: Map<string, TeamDayAssignment[]>;
  /**
   * Items that HAVE workers but overlap no crew (the SA planned pool or
   * otherwise un-teamed workers individually) — shown read-only.
   */
  individual: DayPlanWpItem[];
}

export function buildDayAssignments(
  items: ReadonlyArray<DayPlanWpItem>,
  teams: ReadonlyArray<TeamMapTeamCard>,
): DayAssignments {
  const crews = teams.filter((t) => t.kind === "crew");
  const memberSets = new Map(crews.map((c) => [c.id, new Set(c.members.map((m) => m.workerId))]));

  const tray: DayPlanWpItem[] = [];
  const byTeam = new Map<string, TeamDayAssignment[]>();
  const individual: DayPlanWpItem[] = [];

  for (const item of items) {
    if (item.workerIds.length === 0) {
      tray.push(item);
      continue;
    }
    let matched = false;
    for (const crew of crews) {
      const members = memberSets.get(crew.id);
      if (!members) continue;
      const overlap = item.workerIds.some((w) => members.has(w));
      if (!overlap) continue;
      matched = true;
      const mixed = !item.workerIds.every((w) => members.has(w));
      const list = byTeam.get(crew.id);
      if (list) list.push({ item, mixed });
      else byTeam.set(crew.id, [{ item, mixed }]);
    }
    if (!matched) individual.push(item);
  }

  return { tray, byTeam, individual };
}
