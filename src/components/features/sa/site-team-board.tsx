"use client";

// Spec 282 U2 (approach A) — the SA site team board. One glance: how many people are
// on site, split into ทีมภายใน (our workers crews) · ทีมภายนอก (subcon crews) · ฝ่ายไซต์
// (site_admin/site_owner, from the U1 definer read) · ยังไม่ได้จัดทีม, each with a subtotal
// and a grand total on top. Crew cards COLLAPSE ('use client' — the one interaction):
// collapsed = name + lead + count + งาน chips; tap → members with level, employment, and
// the cross-charge exception badge (our tech on an external team / a subcontractor's
// worker on ours). VIEW-ONLY — moves are spec 279 U5.

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { EmptyNotice } from "@/components/features/common/notices";
import { WpCategoryCode } from "@/components/features/work-packages/wp-category-code";
import { CountBadge, EmploymentBadge } from "@/components/features/sa/crew-team-roster";
import { WORKER_LEVEL_LABEL } from "@/lib/nova/dials";
import {
  BANK_PENDING_CHIP_LABEL,
  EXCEPTION_OUR_TECH_EXTERNAL_LABEL,
  EXCEPTION_SUBCON_INTERNAL_LABEL,
  SITE_ACCESS_LABEL,
  SITE_HEADCOUNT_LABEL,
  TEAM_EXTERNAL_LABEL,
  TEAM_INTERNAL_LABEL,
  UNASSIGNED_TEAM_LABEL,
} from "@/lib/i18n/labels";
import type {
  SiteAccessMember,
  SiteTeamBoard as SiteTeamBoardData,
  SiteTeamGroup,
  SiteTeamMember,
  TeamException,
} from "@/lib/sa/site-team-board";

const EXCEPTION_LABEL: Record<TeamException, string> = {
  our_tech_external: EXCEPTION_OUR_TECH_EXTERNAL_LABEL,
  subcon_internal: EXCEPTION_SUBCON_INTERNAL_LABEL,
};

function ExceptionBadge({ exception }: { exception: TeamException }) {
  // A cross-charge the arrangement disagrees with the team's nature — the notable
  // case worth an SA's eye, so it takes the attention tint.
  return (
    <span className="bg-attn-soft text-attn-ink text-meta shrink-0 rounded-full px-2 py-0.5">
      {EXCEPTION_LABEL[exception]}
    </span>
  );
}

// Spec 334 U2 — the per-name status chips CrewProgressRoster used to own as whole
// sections. Chip classes ported from the retired component so the visual stays put.
const CHIP_CLASS =
  "border-edge bg-sunk text-ink-secondary text-meta rounded-full border px-2 py-0.5";
// Single-surface string (this board is its only home) — stays local per the SSOT rule.
const COST_PENDING_CHIP_LABEL = "รอ PM ยืนยัน";

function MemberRow({ member }: { member: SiteTeamMember }) {
  return (
    <li className="border-edge text-ink flex min-h-11 items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0">
      <span className="min-w-0 truncate font-medium">{member.name}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {member.exception ? <ExceptionBadge exception={member.exception} /> : null}
        {member.costPending ? <span className={CHIP_CLASS}>{COST_PENDING_CHIP_LABEL}</span> : null}
        {member.bankPending ? <span className={CHIP_CLASS}>{BANK_PENDING_CHIP_LABEL}</span> : null}
        {member.employmentType ? <EmploymentBadge type={member.employmentType} /> : null}
        {member.level ? (
          <span className={CHIP_CLASS}>{WORKER_LEVEL_LABEL[member.level]}</span>
        ) : null}
      </span>
    </li>
  );
}

function GaanChips({ workPackages }: { workPackages: NonNullable<SiteTeamGroup["workPackages"]> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
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

function TeamCard({ team }: { team: SiteTeamGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label={team.name}
      className="rounded-card border-edge bg-card shadow-card flex flex-col border"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex flex-col gap-2 p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <Users aria-hidden className="text-ink-secondary size-5 shrink-0" />
          <h4 className="text-body text-ink min-w-0 flex-1 truncate font-semibold">{team.name}</h4>
          <CountBadge n={team.members.length} />
          <ChevronDown
            aria-hidden
            className={`text-ink-muted size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
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
        {team.workPackages && team.workPackages.length > 0 ? (
          <GaanChips workPackages={team.workPackages} />
        ) : null}
      </button>
      {open ? (
        <ul className="flex flex-col px-4 pb-3">
          {team.members.length > 0 ? (
            team.members.map((m) => <MemberRow key={m.id} member={m} />)
          ) : (
            <li className="text-ink-muted text-meta py-1">ยังไม่มีสมาชิก</li>
          )}
        </ul>
      ) : null}
    </section>
  );
}

function Bucket({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-meta text-ink-secondary font-semibold">{label}</h3>
        <CountBadge n={count} />
      </div>
      {children}
    </div>
  );
}

function memberCount(teams: SiteTeamGroup[]): number {
  return teams.reduce((n, t) => n + t.members.length, 0);
}

function PeopleList({ people }: { people: { key: string; name: string | null }[] }) {
  return (
    <ul className="rounded-card border-edge bg-card shadow-card flex flex-col border px-4">
      {people.map((p) => (
        <li
          key={p.key}
          className="border-edge text-ink flex min-h-11 items-center border-b py-2.5 text-sm font-medium last:border-b-0"
        >
          {p.name ?? "—"}
        </li>
      ))}
    </ul>
  );
}

// The hub's historical empty copy — the default so the /team call site renders
// byte-identically until task 4 removes the board from the hub.
const DEFAULT_EMPTY_LABEL = "ยังไม่มีคนหน้างาน — เพิ่มช่างแล้วให้หัวหน้าจัดเป็นทีม";

export function SiteTeamBoard({
  board,
  emptyLabel = DEFAULT_EMPTY_LABEL,
}: {
  board: SiteTeamBoardData;
  /** Spec 334 U2 — the /team/roster page overrides the empty copy (ช่าง-first). */
  emptyLabel?: string;
}) {
  const { total, internal, external, siteAccess, unassigned } = board;
  // Spec 334 U2 review fix: the empty notice keys on WORKERS, not total — a real
  // SA always appears in ฝ่ายไซต์ (project_site_management returns the viewer),
  // so a total===0 branch could never fire in production. Zero workers → show the
  // notice AND still render whatever buckets exist (ฝ่ายไซต์).
  const workerTotal = memberCount(internal) + memberCount(external) + unassigned.length;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Users aria-hidden className="text-action size-5 shrink-0" />
        <span className="text-body text-ink font-semibold">{SITE_HEADCOUNT_LABEL}</span>
        <CountBadge n={total} />
      </header>

      {workerTotal === 0 ? <EmptyNotice>{emptyLabel}</EmptyNotice> : null}
      {total > 0 ? (
        <div className="flex flex-col gap-5">
          {internal.length > 0 ? (
            <Bucket label={TEAM_INTERNAL_LABEL} count={memberCount(internal)}>
              <div className="flex flex-col gap-3">
                {internal.map((t) => (
                  <TeamCard key={t.id} team={t} />
                ))}
              </div>
            </Bucket>
          ) : null}

          {external.length > 0 ? (
            <Bucket label={TEAM_EXTERNAL_LABEL} count={memberCount(external)}>
              <div className="flex flex-col gap-3">
                {external.map((t) => (
                  <TeamCard key={t.id} team={t} />
                ))}
              </div>
            </Bucket>
          ) : null}

          {siteAccess.length > 0 ? (
            <Bucket label={SITE_ACCESS_LABEL} count={siteAccess.length}>
              <PeopleList
                people={siteAccess.map((m: SiteAccessMember) => ({ key: m.userId, name: m.name }))}
              />
            </Bucket>
          ) : null}

          {unassigned.length > 0 ? (
            <Bucket label={UNASSIGNED_TEAM_LABEL} count={unassigned.length}>
              {/* Spec 334 U2 review fix: MemberRow, not PeopleList — crewless
                  workers carry the same status chips as crewed ones (on prod
                  every unassigned worker is cost-pending; PeopleList stripped
                  exactly their chips). ฝ่ายไซต์ stays PeopleList (users, not
                  workers — no flags exist for them). */}
              <ul className="rounded-card border-edge bg-card shadow-card flex flex-col border px-4">
                {unassigned.map((m) => (
                  <MemberRow key={m.id} member={m} />
                ))}
              </ul>
            </Bucket>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
