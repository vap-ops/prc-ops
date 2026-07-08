// Spec 279 U7b + U6 — the /sa/crew roster grouped by CREW (team). Each crew shows
// its name + lead + members, plus a "ยังไม่ได้จัดทีม" bucket for workers not yet on
// a crew (U7b). U6 adds two glances the operator asked for: an employment badge on
// each member (ประจำ = internal / ชั่วคราว = day-hired), and a งาน row listing the
// งานย่อย the crew is scheduled on (from แผนพรุ่งนี้, with the spec-277 category
// tile). VIEW-ONLY — no move controls (crew moves are U5, PM-owned). Pure
// presentation; the reads that feed it are RLS-scoped to the SA's projects.

import { Users } from "lucide-react";
import { EmptyNotice } from "@/components/features/common/notices";
import { WpCategoryCode } from "@/components/features/work-packages/wp-category-code";
import { WORKER_LEVEL_LABEL, type WorkerLevel } from "@/lib/nova/dials";
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from "@/lib/workers/employment";

export interface CrewWorkPackage {
  id: string;
  code: string;
  name: string;
  /** Reconciled GLOBAL work-category code (W0x) for the category tile, or null. */
  categoryCode: string | null;
}

export interface CrewTeamMember {
  id: string;
  name: string;
  /** null until a PM confirms the worker's cost/level. */
  level: WorkerLevel | null;
  /** ประจำ (internal) vs ชั่วคราว (day-hired). */
  employmentType?: EmploymentType;
}

export interface CrewTeam {
  id: string;
  name: string;
  /** The crew lead's rendered name; null when no lead is bound. */
  leadName: string | null;
  members: CrewTeamMember[];
  /** งานย่อย the crew is scheduled on (from แผนพรุ่งนี้); omitted/empty → no row. */
  workPackages?: CrewWorkPackage[];
}

export interface CrewTeamData {
  teams: CrewTeam[];
  /** Active workers on the SA's projects who are not on any crew. */
  unassigned: CrewTeamMember[];
}

export function CountBadge({ n }: { n: number }) {
  return (
    <span className="bg-sunk text-ink-secondary text-meta shrink-0 rounded-full px-2 py-0.5 font-bold tabular-nums">
      {n}
    </span>
  );
}

export function EmploymentBadge({ type }: { type: EmploymentType }) {
  // ชั่วคราว (day-hired) is the notable case → attention tint; ประจำ stays neutral.
  const cls = type === "temporary" ? "bg-attn-soft text-attn-ink" : "bg-sunk text-ink-secondary";
  return (
    <span className={`text-meta shrink-0 rounded-full px-2 py-0.5 ${cls}`}>
      {EMPLOYMENT_TYPE_LABEL[type]}
    </span>
  );
}

function MemberRow({
  name,
  level,
  employmentType,
}: {
  name: string;
  level: WorkerLevel | null;
  employmentType?: EmploymentType;
}) {
  return (
    <li className="border-edge text-ink flex min-h-11 items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0">
      <span className="min-w-0 truncate font-medium">{name}</span>
      <span className="flex shrink-0 items-center gap-2">
        {employmentType ? <EmploymentBadge type={employmentType} /> : null}
        {level ? (
          <span className="border-edge bg-sunk text-ink-secondary text-meta rounded-full border px-2 py-0.5">
            {WORKER_LEVEL_LABEL[level]}
          </span>
        ) : null}
      </span>
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
        <MemberRow
          key={m.id}
          name={m.name}
          level={m.level}
          {...(m.employmentType ? { employmentType: m.employmentType } : {})}
        />
      ))}
    </ul>
  );
}

function GaanRow({ workPackages }: { workPackages: CrewWorkPackage[] }) {
  return (
    <div className="border-edge flex flex-wrap items-center gap-2 border-t pt-2.5">
      <span className="text-ink-muted text-meta shrink-0">งาน</span>
      {workPackages.map((wp) => (
        <span
          key={wp.id}
          className="bg-sunk text-ink flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-xs"
        >
          <WpCategoryCode code={wp.code} categoryCode={wp.categoryCode} className="text-xs" />
          <span className="min-w-0 truncate">{wp.name}</span>
        </span>
      ))}
    </div>
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
          {team.workPackages && team.workPackages.length > 0 ? (
            <GaanRow workPackages={team.workPackages} />
          ) : null}
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
