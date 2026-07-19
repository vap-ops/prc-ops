// Spec 330 U1 — pure builder for the per-project team map (ทีมงานโครงการ).
// Shapes the map's three tiers from already-fetched rows; no I/O, unit-tested.
// Position badges come from live facts only (project_lead_id, is_primary,
// crews.lead_worker_id) — the ADR 0080 P2 Position axis re-sources them later.

const MANAGEMENT_ROLES = new Set(["project_manager", "project_director", "super_admin"]);
const SITE_TIER_ROLES = new Set(["site_admin", "site_owner", "auditor"]);

export interface TeamMapStaffNode {
  userId: string;
  name: string | null;
  role: string;
  isLead: boolean;
  isPrimary: boolean;
  // The project lead can sit outside project_members (projects.project_lead_id
  // is its own axis) — rendered with a hint, and remove doesn't apply.
  isMember: boolean;
}

export interface TeamMapWorkerChip {
  workerId: string;
  name: string;
  isTeamLead: boolean;
  // Carried on the CHIP, not inferred from the card's `kind`: once a firm
  // worker sits in a crew the card reads `kind: "crew"`, so kind is
  // self-erasing as a pay-exempt discriminator (spec 328 §2.4). The DB wall
  // (mig 075818) makes that unreachable — this keeps the UI honest anyway.
  contractorId: string | null;
}

export interface TeamMapTeamCard {
  kind: "crew" | "firm" | "unassigned";
  id: string;
  name: string;
  members: TeamMapWorkerChip[];
  count: number;
}

export interface ProjectTeamMap {
  management: TeamMapStaffNode[];
  site: TeamMapStaffNode[];
  teams: TeamMapTeamCard[];
  crewTotal: number;
  teamCount: number;
  // True project_members count — the client-side last-member guard must see
  // ALL members, not just the two rendered tiers (a role outside both tiers
  // still holds membership; fresh-eyes catch).
  memberCount: number;
}

export interface BuildProjectTeamMapInput {
  projectLeadId: string | null;
  members: { user_id: string; is_primary: boolean }[];
  users: Map<string, { name: string | null; role: string }>;
  workers: { id: string; name: string; contractor_id: string | null }[];
  crews: { id: string; name: string; lead_worker_id: string | null; active: boolean }[];
  crewMembers: { crew_id: string; worker_id: string; removed_at: string | null }[];
  contractors: Map<string, string>;
}

export function buildProjectTeamMap(input: BuildProjectTeamMapInput): ProjectTeamMap {
  const { projectLeadId } = input;

  const staffNode = (userId: string, isPrimary: boolean, isMember: boolean): TeamMapStaffNode => {
    const meta = input.users.get(userId);
    return {
      userId,
      name: meta?.name ?? null,
      role: meta?.role ?? "",
      isLead: userId === projectLeadId,
      isPrimary,
      isMember,
    };
  };

  const memberNodes = input.members.map((m) => staffNode(m.user_id, m.is_primary, true));
  const management = memberNodes.filter((n) => MANAGEMENT_ROLES.has(n.role));
  // A lead outside the membership still anchors the tier (settings can point
  // project_lead_id at any staff user). Gate on ALL member nodes — a lead who
  // is a member with a SITE role renders in the site tier, not as a phantom
  // management row (fresh-eyes catch: the lead picker offers site_admins).
  if (projectLeadId && !memberNodes.some((n) => n.isLead)) {
    management.push(staffNode(projectLeadId, false, false));
  }
  management.sort((a, b) => Number(b.isLead) - Number(a.isLead));

  const site = memberNodes.filter((n) => SITE_TIER_ROLES.has(n.role));
  site.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  const workerById = new Map(input.workers.map((w) => [w.id, w]));
  const activeCrews = input.crews.filter((c) => c.active);
  const activeCrewIds = new Set(activeCrews.map((c) => c.id));
  const inActiveCrew = new Set(
    input.crewMembers
      .filter((cm) => cm.removed_at === null && activeCrewIds.has(cm.crew_id))
      .map((cm) => cm.worker_id),
  );

  const crewCards: TeamMapTeamCard[] = activeCrews
    .map((crew) => {
      const memberIds = input.crewMembers
        .filter(
          (cm) => cm.crew_id === crew.id && cm.removed_at === null && workerById.has(cm.worker_id),
        )
        .map((cm) => cm.worker_id);
      // Lead chip first; the lead is expected to be a member, but a dangling
      // lead_worker_id must not duplicate or invent a chip.
      const ordered = [
        ...memberIds.filter((id) => id === crew.lead_worker_id),
        ...memberIds.filter((id) => id !== crew.lead_worker_id),
      ];
      const members = ordered.map((id) => ({
        workerId: id,
        name: workerById.get(id)?.name ?? "",
        isTeamLead: id === crew.lead_worker_id,
        contractorId: workerById.get(id)?.contractor_id ?? null,
      }));
      return {
        kind: "crew" as const,
        id: crew.id,
        name: crew.name,
        members,
        count: members.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  // Firm teams: contractor-tied workers not already in an active crew.
  const firmWorkers = input.workers.filter(
    (w) => w.contractor_id !== null && !inActiveCrew.has(w.id),
  );
  const byFirm = new Map<string, typeof firmWorkers>();
  for (const w of firmWorkers) {
    const key = w.contractor_id as string;
    byFirm.set(key, [...(byFirm.get(key) ?? []), w]);
  }
  const firmCards: TeamMapTeamCard[] = [...byFirm.entries()]
    .map(([contractorId, list]) => ({
      kind: "firm" as const,
      id: contractorId,
      name: input.contractors.get(contractorId) ?? "ทีมผู้รับเหมา",
      members: list.map((w) => ({
        workerId: w.id,
        name: w.name,
        isTeamLead: false,
        contractorId: w.contractor_id,
      })),
      count: list.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  const pooled = input.workers.filter((w) => w.contractor_id === null && !inActiveCrew.has(w.id));
  const teams: TeamMapTeamCard[] = [...crewCards, ...firmCards];
  if (pooled.length > 0) {
    teams.push({
      kind: "unassigned",
      id: "unassigned",
      name: "ยังไม่จัดทีม",
      members: pooled.map((w) => ({
        workerId: w.id,
        name: w.name,
        isTeamLead: false,
        contractorId: w.contractor_id,
      })),
      count: pooled.length,
    });
  }

  return {
    management,
    site,
    teams,
    crewTotal: input.workers.length,
    teamCount: crewCards.length + firmCards.length,
    memberCount: input.members.length,
  };
}
