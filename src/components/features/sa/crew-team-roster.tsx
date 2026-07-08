// Spec 279 U7b — the /sa/crew roster grouped by CREW (team). Sits alongside the
// U7 onboarding progress tracker and gives the SA the team structure the operator
// asked for (idea #1): each crew with its name + lead, its members grouped under
// it, plus a "ยังไม่ได้จัดทีม" bucket for workers not yet on a crew. VIEW-ONLY —
// the SA cannot move anyone from here (crew moves are U5, PM-owned), so this
// renders no action controls. Pure presentation; the crew reads that feed it are
// RLS-scoped to the SA's projects by the U7b read-grant (mig 075460). Money
// (default_day_rate) is never read here.

import { Users } from "lucide-react";
import { EmptyNotice } from "@/components/features/common/notices";
import { WORKER_LEVEL_LABEL, type WorkerLevel } from "@/lib/nova/dials";

export interface CrewTeamMember {
  id: string;
  name: string;
  /** null until a PM confirms the worker's cost/level. */
  level: WorkerLevel | null;
}

export interface CrewTeam {
  id: string;
  name: string;
  /** The crew lead's rendered name; null when no lead is bound. */
  leadName: string | null;
  members: CrewTeamMember[];
}

export interface CrewTeamData {
  teams: CrewTeam[];
  /** Active workers on the SA's projects who are not on any crew. */
  unassigned: CrewTeamMember[];
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="bg-sunk text-ink-secondary text-meta shrink-0 rounded-full px-2 py-0.5 font-bold tabular-nums">
      {n}
    </span>
  );
}

function MemberRow({ name, level }: { name: string; level: WorkerLevel | null }) {
  return (
    <li className="border-edge text-ink flex min-h-11 items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0">
      <span className="min-w-0 truncate font-medium">{name}</span>
      {level ? (
        <span className="border-edge bg-sunk text-ink-secondary text-meta shrink-0 rounded-full border px-2 py-0.5">
          {WORKER_LEVEL_LABEL[level]}
        </span>
      ) : null}
    </li>
  );
}

function MemberList({ members }: { members: CrewTeamMember[] }) {
  if (members.length === 0) {
    return <p className="text-ink-muted text-meta py-1">ยังไม่มีสมาชิก</p>;
  }
  return (
    <ul className="flex flex-col">
      {members.map((m) => (
        <MemberRow key={m.id} name={m.name} level={m.level} />
      ))}
    </ul>
  );
}

export function CrewTeamRoster({ data }: { data: CrewTeamData }) {
  if (data.teams.length === 0 && data.unassigned.length === 0) {
    return <EmptyNotice>ยังไม่มีทีม — เพิ่มช่างแล้วให้หัวหน้าจัดเป็นทีม</EmptyNotice>;
  }

  return (
    <div className="flex flex-col gap-4">
      {data.teams.map((team) => (
        <section
          key={team.id}
          aria-label={team.name}
          className="rounded-card border-edge bg-card shadow-card flex flex-col gap-2 border p-4"
        >
          <div className="flex items-center gap-2">
            <Users aria-hidden className="text-ink-secondary size-5 shrink-0" />
            <h3 className="text-body text-ink min-w-0 truncate font-semibold">{team.name}</h3>
            <CountBadge n={team.members.length} />
          </div>
          <p className="text-ink-secondary text-meta">
            {team.leadName ? (
              <>
                หัวหน้า: <span className="text-ink font-medium">{team.leadName}</span>
              </>
            ) : (
              "ยังไม่มีหัวหน้า"
            )}
          </p>
          <MemberList members={team.members} />
        </section>
      ))}

      {data.unassigned.length > 0 ? (
        <section
          aria-label="ยังไม่ได้จัดทีม"
          className="rounded-card border-edge bg-card shadow-card flex flex-col gap-2 border p-4"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-meta text-ink-secondary font-semibold">ยังไม่ได้จัดทีม</h3>
            <CountBadge n={data.unassigned.length} />
          </div>
          <MemberList members={data.unassigned} />
        </section>
      ) : null}
    </div>
  );
}
