// Spec 282 U2 (approach A) — the pure bucket builder behind the SA site team board.
// Takes the buildCrewTeams output (teams + unassigned) and buckets it by team
// nature — ทีมภายใน (our workers crews) vs ทีมภายนอก (kind='subcon') — adds the
// ฝ่ายไซต์ (site_admin/site_owner) bucket from the U1 definer read, and a total
// headcount. Per approach A it ANNOTATES the operator's two cross-charges as
// per-member badges WITHOUT reclassifying the headcount: a worker whose
// contractor_id disagrees with their team's nature (our tech on an external team;
// a subcontractor's worker on an internal team). The true who-pays-whom split waits
// for the ADR-0060 cost ledger. Pure over already-derived rows.

import type { CrewTeam, CrewTeamMember } from "@/components/features/sa/crew-team-roster";

/** The kind that marks a crew as an external (subcontractor) team. */
const SUBCON_KIND = "subcon";

/** A cross-charge the arrangement disagrees with the team's nature (approach A). */
export type TeamException =
  /** our company worker (no contractor) placed on an external/subcon team. */
  | "our_tech_external"
  /** a subcontractor's worker (has a contractor) placed on an internal team. */
  | "subcon_internal";

export interface SiteTeamMember extends CrewTeamMember {
  /** Set only when the member's contractor_id disagrees with their team's nature. */
  exception?: TeamException;
}

export interface SiteTeamGroup extends Omit<CrewTeam, "members"> {
  members: SiteTeamMember[];
}

/** A ฝ่ายไซต์ member — a site_admin/site_owner user (from project_site_management). */
export interface SiteAccessMember {
  userId: string;
  name: string | null;
}

export interface SiteTeamBoard {
  /** roster composition on the SA's projects: crew members + loose + ฝ่ายไซต์. */
  total: number;
  internal: SiteTeamGroup[];
  external: SiteTeamGroup[];
  siteAccess: SiteAccessMember[];
  unassigned: SiteTeamMember[];
}

export interface SiteTeamBoardInput {
  teams: CrewTeam[];
  unassigned: CrewTeamMember[];
  /** crew.id → crews.kind ('dc' | 'subcon' | …). Missing → internal. */
  crewKindById: ReadonlyMap<string, string>;
  /** worker.id → workers.contractor_id (null = our company worker). */
  contractorByWorker: ReadonlyMap<string, string | null>;
  siteAccess: SiteAccessMember[];
}

function annotate(
  member: CrewTeamMember,
  isExternal: boolean,
  contractorByWorker: ReadonlyMap<string, string | null>,
): SiteTeamMember {
  const contractorId = contractorByWorker.get(member.id) ?? null;
  let exception: TeamException | undefined;
  if (isExternal && contractorId === null) exception = "our_tech_external";
  else if (!isExternal && contractorId !== null) exception = "subcon_internal";
  return exception ? { ...member, exception } : { ...member };
}

export function buildSiteTeamBoard(input: SiteTeamBoardInput): SiteTeamBoard {
  const { teams, unassigned, crewKindById, contractorByWorker, siteAccess } = input;

  const internal: SiteTeamGroup[] = [];
  const external: SiteTeamGroup[] = [];

  for (const t of teams) {
    const isExternal = crewKindById.get(t.id) === SUBCON_KIND;
    const group: SiteTeamGroup = {
      ...t,
      members: t.members.map((m) => annotate(m, isExternal, contractorByWorker)),
    };
    (isExternal ? external : internal).push(group);
  }

  const looseMembers: SiteTeamMember[] = unassigned.map((m) => ({ ...m }));

  const crewCount = teams.reduce((n, t) => n + t.members.length, 0);
  const total = crewCount + looseMembers.length + siteAccess.length;

  return { total, internal, external, siteAccess, unassigned: looseMembers };
}
