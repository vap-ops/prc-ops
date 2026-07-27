// Spec 365 — leadTradesOf moved out of team-map-view.tsx so both it and the
// new plan-tab.tsx can read a team's lead trades without a circular import
// between the two component files.
import type { TeamMapTeamCard } from "./build-team-map";
import type { WorkerTrade } from "@/lib/workers/trades";

export function leadTradesOf(
  team: TeamMapTeamCard,
  trades?: Record<string, WorkerTrade[]>,
): WorkerTrade[] {
  const lead = team.members.find((m) => m.isTeamLead);
  return lead ? (trades?.[lead.workerId] ?? []) : [];
}
