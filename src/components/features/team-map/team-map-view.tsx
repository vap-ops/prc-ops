"use client";

// Spec 330 U1+U5 — the per-project team map (ทีมงานโครงการ). Two tiers:
// สนับสนุน (merged ผู้บริหารโครงการ + หน้างาน) → ทีมช่าง, each a bordered
// container whose header carries the tier's own action (เพิ่มสมาชิก /
// ตั้งทีมใหม่ — U5 un-buried it from the add sheet, operator ask 2026-07-19)
// plus an ⓘ role explainer.
// Member lists collapse per card + a master toggle; counts stay visible
// collapsed (operator requirement).
// 'use client': collapse state, sheet state, and action relays live here.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building2,
  CircleHelp,
  ClipboardList,
  Eye,
  Info,
  KeyRound,
  MapPin,
  Settings,
  Star,
  UserPlus,
  Users,
} from "lucide-react";

import {
  addProjectMember,
  removeProjectMember,
  setPrimaryProjectFor,
} from "@/app/projects/[projectId]/settings/actions";
import { addDailyPlanItem, setDailyPlanItemCrew } from "@/app/sa/plan/actions";
import {
  buildDayAssignments,
  type DayPlanWpItem,
  type TeamDayAssignment,
  type TeamMapDayPlan,
} from "@/lib/work-plans/day-assignments";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { CategoryChip } from "@/components/features/work-packages/category-chip";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { TEAM_MAP_ROLE_HELP } from "@/lib/help/team-map-roles";
import { tradeMismatchCode, type WorkerTrade } from "@/lib/workers/trades";
import type {
  ProjectTeamMap,
  TeamMapStaffNode,
  TeamMapTeamCard,
  TeamMapWorkerChip,
} from "@/lib/team-map/build-team-map";
import {
  addWorkerToCrew,
  createCrew,
  dissolveCrew,
  moveWorkerBetweenCrews,
  removeWorkerFromCrew,
  renameCrew,
  setCrewLead,
} from "@/lib/team-map/crew-actions";
import { TRADE_MISMATCH_HINT, USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { evaluateMemberRemoval } from "@/lib/projects/member-removal";
import { useToast } from "@/lib/ui/use-toast";
import { leadTradesOf } from "@/lib/team-map/trade-hint";
import { TIER_ACTION, SHEET_ACTION } from "./action-classes";

export interface AddableStaff {
  id: string;
  name: string | null;
  role: string;
}

// ONE sheet at a time — every surface rides the same union so two dialogs can
// never stack.
type InfoTier = "management" | "site" | "crew" | "firm";

type SheetState =
  | { type: "staff"; node: TeamMapStaffNode }
  | { type: "add" }
  | { type: "createCrew" }
  | { type: "team"; team: TeamMapTeamCard }
  | { type: "chip"; chip: TeamMapWorkerChip; team: TeamMapTeamCard }
  | { type: "info"; tier: InfoTier }
  | { type: "planChip"; entry: TeamDayAssignment; team: TeamMapTeamCard }
  | { type: "addPlanWp" }
  | null;

/** Leaf WPs offered by เพิ่มงานเข้าแผน (page pre-filters groups + complete). */
export interface PlanWpOption {
  id: string;
  code: string;
  name: string;
}

const TIER_HEADING = "text-ink-secondary text-xs font-medium";
// U5 map-look: every tier renders inside a bordered container whose header row
// carries the tier icon, counts, ⓘ, and the tier's OWN action button. Token
// classes only — the design-doctrine guard bans raw Tailwind palette.
const TIER_BOX = "border-edge bg-sunk rounded-card border p-3";
// Spec 338 U1 — the 3-tier button hierarchy. Exactly ONE primary per surface
// (the constructive action); danger = the wp-delete-control pattern so every
// destructive control reads the same app-wide. Everything else stays secondary.
const TIER_ACTION_PRIMARY =
  "bg-action text-on-fill inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium";
const SHEET_PRIMARY =
  "bg-action text-on-fill flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium";
const SHEET_DANGER =
  "border-edge-strong bg-card text-danger hover:bg-danger-soft flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm";
const INFO_BTN = "text-ink-muted min-h-11 shrink-0 px-1";
const AVATAR =
  "bg-sunk text-ink-secondary flex size-8 shrink-0 items-center justify-center rounded-full";
// Border colour is per-kind (firm cards read stronger) — keep it OUT of CARD
// so the two utilities never compete on the same element.
const CARD = "rounded-card bg-card flex flex-col gap-2 border px-3 py-2";
const STAFF_ROW =
  "rounded-card border-edge bg-card flex min-h-11 w-full items-center gap-3 border px-3 py-2 text-left";
const BADGE =
  "bg-sunk text-ink-secondary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium";
const CHIP = "bg-sunk text-ink rounded-full px-2.5 py-1 text-xs";
// Spec 338 U1 — a contractor-tied worker's chip is dashed wherever it renders.
// Keyed on the CHIP's contractorId, never the card's kind (spec 328 §2.4: kind
// self-erases the moment such a worker sits in a crew).
const CHIP_EXEMPT =
  "border-edge-strong text-ink-secondary bg-card rounded-full border border-dashed px-2.5 py-1 text-xs";
const TOGGLE = "text-action min-h-11 shrink-0 px-2 text-xs font-medium";

function roleLabel(role: string): string {
  return (USER_ROLE_LABEL as Record<string, string>)[role] ?? role;
}

// U5: one face-icon per role so the tiers read as an org chart, not a list.
// The project lead outranks their role icon (★). Exhaustive over the builder's
// tier buckets (MANAGEMENT_ROLES + SITE_TIER_ROLES); anything else falls back
// to the generic user glyph.
function RoleIcon({ node }: { node: TeamMapStaffNode }) {
  const cls = "size-4";
  if (node.isLead) return <Star aria-hidden className={cls} />;
  switch (node.role) {
    case "project_manager":
    case "project_director":
      return <Briefcase aria-hidden className={cls} />;
    case "super_admin":
      return <Settings aria-hidden className={cls} />;
    case "site_admin":
      return <ClipboardList aria-hidden className={cls} />;
    case "site_owner":
      return <KeyRound aria-hidden className={cls} />;
    case "auditor":
      return <Eye aria-hidden className={cls} />;
    default:
      return <Users aria-hidden className={cls} />;
  }
}

function StaffRow({ node, onOpen }: { node: TeamMapStaffNode; onOpen: () => void }) {
  return (
    <button type="button" className={STAFF_ROW} onClick={onOpen}>
      <span className={AVATAR} aria-hidden>
        <RoleIcon node={node} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink block truncate text-sm font-medium">
          {node.name ?? node.userId.slice(0, 8)}
        </span>
        <span className="text-ink-secondary block text-xs">{roleLabel(node.role)}</span>
      </span>
      {node.isLead ? (
        <span className={BADGE}>
          <Star aria-hidden className="size-3" /> หัวหน้าโครงการ
        </span>
      ) : null}
      {node.isPrimary ? (
        <span className={BADGE}>
          <Star aria-hidden className="size-3" /> หลัก
        </span>
      ) : null}
    </button>
  );
}

// Spec 338 U2 — the trade tiles beside a name. Icon-only CategoryChips,
// primary-first order comes from the fold; chips show the FIRST tile only
// (compact), the lead band/line shows them all.
function TradeTiles({ trades, firstOnly }: { trades: WorkerTrade[]; firstOnly?: boolean }) {
  const shown = firstOnly ? trades.slice(0, 1) : trades;
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((t) => (
        <CategoryChip key={t.categoryId} code={t.code} />
      ))}
    </>
  );
}

function TeamCard({
  team,
  expanded,
  onToggle,
  onManage,
  onChip,
  tradesByWorker,
  planChips,
  onPlanChip,
  projectId,
}: {
  team: TeamMapTeamCard;
  expanded: boolean;
  onToggle: () => void;
  onManage: () => void;
  onChip: (chip: TeamMapWorkerChip) => void;
  tradesByWorker?: Record<string, WorkerTrade[]>;
  planChips?: TeamDayAssignment[];
  onPlanChip?: (entry: TeamDayAssignment) => void;
  /** Spec 365 — only read for a zero-member firm card's QR door. */
  projectId?: string;
}) {
  const tradesFor = (workerId: string) => tradesByWorker?.[workerId] ?? [];
  const lead = team.members.find((m) => m.isTeamLead);
  const Icon = team.kind === "firm" ? Building2 : team.kind === "unassigned" ? CircleHelp : Users;
  // Spec 338 U1: the ผู้รับเหมา word moves into the header badge — the subtitle
  // stops repeating it and the card border reads stronger than a crew's.
  const subtitle =
    team.kind === "firm"
      ? `${team.count} คน · เบิกจ่ายผ่านหัวหน้าทีม`
      : team.kind === "unassigned"
        ? `${team.count} คน`
        : `ทีม PRC · ${team.count} คน`;
  return (
    <div
      data-testid={`team-card-${team.id}`}
      className={`${CARD} ${
        team.kind === "unassigned"
          ? "border-edge border-dashed"
          : team.kind === "firm"
            ? "border-edge-strong"
            : "border-edge"
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon aria-hidden className="text-ink-secondary size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-sm font-medium">{team.name}</span>
          <span className="text-ink-secondary block text-xs">{subtitle}</span>
        </span>
        {team.kind === "firm" ? (
          <span className={`${BADGE} border-edge-strong border`}>ผู้รับเหมา</span>
        ) : null}
        {/* SIBLING of the toggle, never a wrapper: a wrapping button would
            swallow the toggle into its accessible name and is invalid HTML —
            the real parser flattens it, so the tap region would exist in jsdom
            and not in the browser. Crew cards only: a firm card's id is a
            contractor uuid and the pool has no crew to manage. */}
        {team.kind === "crew" ? (
          // Spec 338 U1 (fresh-eyes): a bordered SECONDARY, not the plain
          // toggle look — pain 4 named this exact pair as indistinguishable.
          <button type="button" className={TIER_ACTION} onClick={onManage} aria-label="จัดการทีม">
            จัดการทีม
          </button>
        ) : null}
        <button type="button" className={TOGGLE} onClick={onToggle}>
          {expanded ? "ซ่อน" : "แสดง"}
        </button>
      </div>
      {/* Spec 365 — a firm with zero current workers gets a QR-only join door
          instead of showing nothing. Renders regardless of expand state. */}
      {team.kind === "firm" && team.count === 0 && projectId ? (
        <Link
          href={`/team/poster?contractor=${team.id}&project=${projectId}`}
          className={`${TIER_ACTION} justify-center`}
        >
          <Building2 aria-hidden className="size-3.5" /> แชร์ QR สมัคร
        </Link>
      ) : null}
      {/* U6: the team's plan-of-day WPs — derived worker-overlap chips. */}
      {planChips && planChips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {planChips.map((entry) => (
            <button
              key={entry.item.itemId}
              type="button"
              className="bg-sunk text-ink inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs"
              onClick={() => onPlanChip?.(entry)}
            >
              <MapPin aria-hidden className="text-ink-secondary size-3" />
              <span className="font-medium">{entry.item.code}</span>
              <span className="text-ink-secondary max-w-32 truncate">{entry.item.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {/* Spec 338 U2: the lead is visible WITHOUT expanding — ★ name + trade
          tiles (deliberately supersedes U1's collapsed-counts-only rule for
          the lead alone; operator pain 2). Same chip sheet as the band. */}
      {!expanded && team.kind === "crew" && lead ? (
        <button
          type="button"
          data-testid="collapsed-lead-line"
          className="border-edge bg-sunk text-ink flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-xs font-medium"
          onClick={() => onChip(lead)}
        >
          <Star aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{lead.name}</span>
          <TradeTiles trades={tradesFor(lead.workerId)} />
        </button>
      ) : null}
      {/* U5: a crew with NO lead surfaces that as a visible to-do while the
          card is collapsed — tapping it expands the list so the lead can be
          set by tapping a member (the existing chip-sheet flow). Members must
          exist: on an empty crew the prompt would be a dead end (fresh-eyes). */}
      {!expanded &&
      team.kind === "crew" &&
      team.members.length > 0 &&
      !team.members.some((m) => m.isTeamLead) ? (
        <button
          type="button"
          className="border-edge-strong text-ink-muted flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed px-3 text-left text-xs"
          onClick={onToggle}
        >
          <Star aria-hidden className="size-3.5" /> ยังไม่ตั้งหัวหน้าทีม — แตะเพื่อเลือก
        </button>
      ) : null}
      {expanded ? (
        <div className="border-edge flex flex-col gap-1.5 border-t pt-2">
          {/* U5 lead band: the หัวหน้าทีม renders as an emphasized full-width
              band above the member chips (still a button — same chip sheet). */}
          {team.members
            .filter((m) => m.isTeamLead)
            .map((m) => (
              <button
                key={m.workerId}
                type="button"
                data-testid="crew-lead-band"
                className="border-edge bg-card text-ink flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-xs font-medium"
                onClick={() => onChip(m)}
              >
                <Star aria-hidden className="size-3.5" /> {m.name}
                <span className="text-ink-secondary font-normal">หัวหน้าทีม</span>
                <TradeTiles trades={tradesFor(m.workerId)} />
              </button>
            ))}
          <div className="flex flex-wrap gap-1.5">
            {team.members
              .filter((m) => !m.isTeamLead)
              .map((m) => (
                <button
                  key={m.workerId}
                  type="button"
                  className={`${m.contractorId !== null ? CHIP_EXEMPT : CHIP} inline-flex min-h-11 items-center gap-1`}
                  onClick={() => onChip(m)}
                >
                  {m.name}
                  <TradeTiles trades={tradesFor(m.workerId)} firstOnly />
                </button>
              ))}
            {team.members.length === 0 ? (
              <span className="text-ink-muted text-xs">ยังไม่มีสมาชิก</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TeamMapView({
  projectId,
  map,
  addableStaff,
  currentUserId,
  tradesByWorker,
  dayPlans,
  planWps,
}: {
  projectId: string;
  map: ProjectTeamMap;
  addableStaff: AddableStaff[];
  currentUserId: string;
  /** Spec 338 U2: per-worker trades (primary-first). Omitted → no tiles. */
  tradesByWorker?: Record<string, WorkerTrade[]>;
  /** U6: the two writable boards. Omitted → the plan layer does not render. */
  dayPlans?: { today: TeamMapDayPlan; tomorrow: TeamMapDayPlan };
  /** U6: leaf WPs for เพิ่มงานเข้าแผน (page pre-filters groups/complete). */
  planWps?: PlanWpOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSelfRemove, setConfirmSelfRemove] = useState<TeamMapStaffNode | null>(null);
  const [confirmDissolve, setConfirmDissolve] = useState<TeamMapTeamCard | null>(null);
  const [crewName, setCrewName] = useState("");
  // U6: selected board for เพิ่มงานเข้าแผน/the assigned plan-chip sheet. Both
  // days are pre-loaded. The day toggle and the tap-tap placing UI moved out
  // of this component with the tray (spec 365 Task 5); `setPlacing` survives
  // only because the plan-chip sheet's ย้ายไปทีมอื่น still primes it — Task 8
  // rebuilds the drop-target list that consumes it.
  const [day] = useState<"today" | "tomorrow">("today");
  const [, setPlacing] = useState<DayPlanWpItem | null>(null);

  const allExpanded = map.teams.length > 0 && map.teams.every((t) => expanded.has(t.id));
  const teamHref = `/projects/${projectId}/team`;
  const teamSheet = sheet?.type === "team" ? sheet.team : null;
  const chipSheet = sheet?.type === "chip" ? sheet : null;
  const planDate = dayPlans ? dayPlans[day].date : null;
  const assignments = useMemo(
    () => (dayPlans ? buildDayAssignments(dayPlans[day].items, map.teams) : null),
    [dayPlans, day, map.teams],
  );
  // Move/add targets are CREW cards only — never a firm card (its id is a
  // contractor uuid) and never the pool (id is the string "unassigned").
  const otherCrews = (currentId: string) =>
    map.teams.filter((t) => t.kind === "crew" && t.id !== currentId);
  // Spec 365 — ทีมช่าง splits into ทีมภายใน (crews + the unassigned pool, which
  // is not contractor-tied) and ทีมภายนอก (subcontractor firms).
  const crewCards = map.teams.filter((t) => t.kind === "crew");
  const firmCards = map.teams.filter((t) => t.kind === "firm");
  const unassignedCard = map.teams.find((t) => t.kind === "unassigned") ?? null;
  // Pay-exempt is a property of the WORKER, read off the chip. The card's
  // `kind` cannot answer it: a contractor-tied worker sitting in a crew makes
  // the card read "crew" (spec 328 §2.4).
  const chipIsPayExempt = chipSheet !== null && chipSheet.chip.contractorId !== null;
  const chipInCrew = chipSheet !== null && chipSheet.team.kind === "crew";

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function closeSheet() {
    setSheet(null);
    setError(null);
    setCrewName("");
  }

  // EVERY sheet opens through here. Setting `sheet` directly leaks the previous
  // sheet's error and crew-name into the next one (run() closes whatever sheet
  // is open at RESOLUTION time, so the two drift apart), and the rename input
  // needs its field seeded with the crew's current name so a controlled input
  // can tell "unchanged" from "cleared".
  function openSheet(next: SheetState) {
    setSheet(next);
    setError(null);
    setBusy(false);
    setCrewName(next?.type === "team" ? next.team.name : "");
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    setBusy(true);
    void (async () => {
      // try/catch: a network-failed server action rejects — busy must reset
      // or every sheet button wedges disabled (fresh-eyes catch).
      try {
        const r = await action();
        if (!r.ok) {
          setError(r.error ?? "ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          return;
        }
        toast.success(done);
        closeSheet();
        router.refresh();
      } catch {
        setError("ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      } finally {
        setBusy(false);
      }
    })();
  }

  function onRemove(node: TeamMapStaffNode) {
    const evaln = evaluateMemberRemoval({
      totalMembers: map.memberCount,
      removingSelf: node.userId === currentUserId,
    });
    if (evaln.blocked) {
      setError("โครงการต้องมีสมาชิกอย่างน้อย 1 คน — เพิ่มสมาชิกคนอื่นก่อนนำคนสุดท้ายออก");
      return;
    }
    if (evaln.needsConfirm) {
      setConfirmSelfRemove(node);
      return;
    }
    run(() => removeProjectMember(projectId, node.userId), "นำออกจากทีมแล้ว");
  }

  const staffSheet = sheet?.type === "staff" ? sheet.node : null;
  const sortedAddable = useMemo(
    () => [...addableStaff].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "th")),
    [addableStaff],
  );

  return (
    <div className="flex flex-col">
      <section aria-label="สนับสนุน" className={TIER_BOX}>
        <div className="mb-2 flex items-center gap-2">
          <Briefcase aria-hidden className="text-ink-secondary size-4 shrink-0" />
          <p className={`${TIER_HEADING} min-w-0 flex-1 truncate`}>
            สนับสนุน · {map.management.length + map.site.length} คน
          </p>
          <button
            type="button"
            className={INFO_BTN}
            aria-label="คำอธิบายบทบาทสนับสนุน"
            onClick={() => openSheet({ type: "info", tier: "management" })}
          >
            <Info aria-hidden className="size-4" />
          </button>
          <button type="button" className={TIER_ACTION} onClick={() => openSheet({ type: "add" })}>
            <UserPlus aria-hidden className="size-3.5" /> เพิ่มสมาชิก
          </button>
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:justify-center sm:[&>button]:min-w-56 sm:[&>button]:flex-none">
          {[...map.management, ...map.site].map((n) => (
            <StaffRow
              key={n.userId}
              node={n}
              onOpen={() => openSheet({ type: "staff", node: n })}
            />
          ))}
          {map.management.length === 0 && map.site.length === 0 ? (
            <p className="text-ink-muted text-xs">ยังไม่มีทีมสนับสนุน</p>
          ) : null}
        </div>
      </section>

      {/* Trunk + rail: the สนับสนุน tier "branches" into the team grid on sm. */}
      <div className="border-edge-strong ml-6 h-4 border-l sm:mx-auto" aria-hidden />
      <div className="border-edge-strong mx-10 hidden border-t sm:block" aria-hidden />
      <div className="mx-10 hidden justify-between sm:flex" aria-hidden>
        <div className="border-edge-strong h-3 border-l" />
        <div className="border-edge-strong h-3 border-l" />
      </div>

      <section aria-label="ทีมภายใน" className={TIER_BOX}>
        <div className="mb-2 flex items-center gap-2">
          <Users aria-hidden className="text-ink-secondary size-4 shrink-0" />
          <p className={`${TIER_HEADING} min-w-0 flex-1 truncate`}>
            ทีมภายใน · จ้างรายวันโดย PRC · {crewCards.length} ทีม
          </p>
          <button
            type="button"
            className={INFO_BTN}
            aria-label="คำอธิบายบทบาททีมภายใน"
            onClick={() => openSheet({ type: "info", tier: "crew" })}
          >
            <Info aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            className={TIER_ACTION_PRIMARY}
            onClick={() => openSheet({ type: "createCrew" })}
          >
            <Users aria-hidden className="size-3.5" /> ตั้งทีมใหม่
          </button>
          {crewCards.length > 0 ? (
            <button
              type="button"
              className={TOGGLE}
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(map.teams.map((t) => t.id)))
              }
            >
              {allExpanded ? "ซ่อนทั้งหมด" : "แสดงทั้งหมด"}
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {crewCards.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              expanded={expanded.has(t.id)}
              onToggle={() => toggle(t.id)}
              onManage={() => openSheet({ type: "team", team: t })}
              onChip={(chip) => openSheet({ type: "chip", chip, team: t })}
              {...(tradesByWorker ? { tradesByWorker } : {})}
              {...(assignments
                ? {
                    planChips: assignments.byTeam.get(t.id) ?? [],
                    onPlanChip: (entry: TeamDayAssignment) =>
                      openSheet({ type: "planChip", entry, team: t }),
                  }
                : {})}
            />
          ))}
          {unassignedCard ? (
            <TeamCard
              key={unassignedCard.id}
              team={unassignedCard}
              expanded={expanded.has(unassignedCard.id)}
              onToggle={() => toggle(unassignedCard.id)}
              onManage={() => {}}
              onChip={(chip) => openSheet({ type: "chip", chip, team: unassignedCard })}
              {...(tradesByWorker ? { tradesByWorker } : {})}
              {...(assignments
                ? {
                    planChips: assignments.byTeam.get(unassignedCard.id) ?? [],
                    onPlanChip: (entry: TeamDayAssignment) =>
                      openSheet({ type: "planChip", entry, team: unassignedCard }),
                  }
                : {})}
            />
          ) : null}
          {crewCards.length === 0 && !unassignedCard ? (
            <p className="text-ink-muted text-xs">ยังไม่มีทีมภายใน</p>
          ) : null}
        </div>
      </section>

      <div className="border-edge-strong ml-6 h-4 border-l sm:mx-auto" aria-hidden />

      <section aria-label="ทีมภายนอก" className={TIER_BOX}>
        <div className="mb-2 flex items-center gap-2">
          <Building2 aria-hidden className="text-ink-secondary size-4 shrink-0" />
          <p className={`${TIER_HEADING} min-w-0 flex-1 truncate`}>
            ทีมภายนอก · ผู้รับเหมาช่วง · {firmCards.length} ราย
          </p>
          <button
            type="button"
            className={INFO_BTN}
            aria-label="คำอธิบายบทบาททีมภายนอก"
            onClick={() => openSheet({ type: "info", tier: "firm" })}
          >
            <Info aria-hidden className="size-4" />
          </button>
          <Link className={TIER_ACTION} href="/contacts">
            <Building2 aria-hidden className="size-3.5" /> เพิ่มผู้รับเหมาช่วง
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {firmCards.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              expanded={expanded.has(t.id)}
              onToggle={() => toggle(t.id)}
              onManage={() => {}}
              onChip={(chip) => openSheet({ type: "chip", chip, team: t })}
              {...(tradesByWorker ? { tradesByWorker } : {})}
              {...(assignments
                ? {
                    planChips: assignments.byTeam.get(t.id) ?? [],
                    onPlanChip: (entry: TeamDayAssignment) =>
                      openSheet({ type: "planChip", entry, team: t }),
                  }
                : {})}
              projectId={projectId}
            />
          ))}
          {firmCards.length === 0 ? (
            <p className="text-ink-muted text-xs">ยังไม่มีผู้รับเหมาช่วงในโครงการนี้</p>
          ) : null}
        </div>
      </section>

      {error && !sheet ? <p className={`${INLINE_ERROR} mt-2`}>{error}</p> : null}

      <BottomSheet
        open={staffSheet !== null}
        title={staffSheet ? `${staffSheet.name ?? ""} · ${roleLabel(staffSheet.role)}` : ""}
        onClose={closeSheet}
      >
        {staffSheet ? (
          <div className="flex flex-col gap-2">
            {staffSheet.role === "site_admin" && !staffSheet.isPrimary ? (
              <button
                type="button"
                disabled={busy}
                className={SHEET_ACTION}
                onClick={() =>
                  run(() => setPrimaryProjectFor(staffSheet.userId, projectId), "ตั้งไซต์หลักแล้ว")
                }
              >
                <Star aria-hidden className="text-ink-secondary size-4" /> ตั้งเป็น SA หลัก
              </button>
            ) : null}
            {staffSheet.isMember ? (
              <button
                type="button"
                disabled={busy}
                className={SHEET_DANGER}
                onClick={() => onRemove(staffSheet)}
              >
                ถอดออกจากทีมโครงการ
              </button>
            ) : (
              <p className="text-ink-muted text-xs">
                หัวหน้าโครงการกำหนดในหน้าตั้งค่าโครงการ (ไม่ได้อยู่ในรายชื่อทีม)
              </p>
            )}
            {error ? <p className={INLINE_ERROR}>{error}</p> : null}
          </div>
        ) : null}
      </BottomSheet>

      {/* U5: staff picker ONLY — ตั้งทีมใหม่ moved to the ทีมช่าง tier header
          (operator: it must not hide behind เพิ่มสมาชิก). */}
      <BottomSheet open={sheet?.type === "add"} title="เพิ่มสมาชิกทีมโครงการ" onClose={closeSheet}>
        <div className="flex flex-col gap-2">
          <p className="text-ink-secondary text-xs">เพิ่มพนักงานเข้าโครงการ</p>
          {sortedAddable.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={busy}
              className={SHEET_ACTION}
              onClick={() => run(() => addProjectMember(projectId, s.id), "เพิ่มสมาชิกแล้ว")}
            >
              <span className="min-w-0 flex-1 truncate">{s.name ?? s.id.slice(0, 8)}</span>
              <span className="text-ink-secondary text-xs">{roleLabel(s.role)}</span>
            </button>
          ))}
          {sortedAddable.length === 0 ? (
            <p className="text-ink-muted text-xs">ไม่มีพนักงานที่เพิ่มได้แล้ว</p>
          ) : null}
          {error ? <p className={INLINE_ERROR}>{error}</p> : null}
        </div>
      </BottomSheet>

      {/* ── crew card manage: rename + dissolve ─────────────────────────── */}
      <BottomSheet
        open={sheet?.type === "team"}
        title={teamSheet ? `จัดการทีม · ${teamSheet.name}` : ""}
        onClose={closeSheet}
      >
        {teamSheet ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-ink-secondary text-xs">ชื่อทีม</span>
              <input
                type="text"
                aria-label="ชื่อทีม"
                maxLength={80}
                value={crewName}
                onChange={(e) => setCrewName(e.target.value)}
                className="border-edge bg-card text-ink min-h-11 rounded-lg border px-3 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              className={SHEET_PRIMARY}
              onClick={() =>
                // The field is CONTROLLED and seeded with the crew's current
                // name by openSheet, so `crewName` is the truth. The old
                // `crewName || teamSheet.name` fallback meant clearing the box
                // silently re-sent the existing name: a success toast and an
                // audit row for a rename that never happened. Blank now reaches
                // the action, which answers "ต้องตั้งชื่อทีม".
                run(
                  () =>
                    renameCrew({
                      crewId: teamSheet.id,
                      name: crewName,
                      revalidate: teamHref,
                    }),
                  "เปลี่ยนชื่อทีมแล้ว",
                )
              }
            >
              บันทึกชื่อ
            </button>
            <button
              type="button"
              disabled={busy}
              className={SHEET_DANGER}
              onClick={() => setConfirmDissolve(teamSheet)}
            >
              ยุบทีม
            </button>
            <p className="text-ink-muted text-xs">
              ยุบทีมแล้วสมาชิกจะกลับไปอยู่ในกลุ่ม “ยังไม่จัดทีม” — ประวัติทีมยังคงอยู่
            </p>
            {error ? <p className={INLINE_ERROR}>{error}</p> : null}
          </div>
        ) : null}
      </BottomSheet>

      {/* ── worker chip: actions scoped to WHERE the worker sits ─────────── */}
      <BottomSheet
        open={sheet?.type === "chip"}
        title={chipSheet ? chipSheet.chip.name : ""}
        onClose={closeSheet}
      >
        {chipSheet ? (
          <div className="flex flex-col gap-2">
            {/* A contractor-tied worker is pay-exempt (spec 328 §2.4, walled in
                Postgres by mig 075818): they may not ENTER the crew graph — no
                add, no move, no lead. Removal is deliberately still offered,
                because the DB deliberately leaves it open: if a pre-wall row
                ever exists, the UI must not be the thing that traps it. The
                chip's own contractorId decides — never the card's `kind`, which
                reads "crew" the moment such a worker sits in one. */}
            {chipSheet.chip.contractorId !== null ? (
              <p className="text-ink-secondary text-sm">
                ช่างของผู้รับเหมา — ผู้รับเหมาเป็นผู้จ่ายค่าแรงเอง จึงจัดเข้าทีมช่างของบริษัทไม่ได้
              </p>
            ) : null}

            {/* Spec 338 U2: the worker's trades, read-only — the editor stays
                on /workers (spec 332), ONE write home. */}
            {(tradesByWorker?.[chipSheet.chip.workerId] ?? []).length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-ink-secondary text-xs">สายงาน</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {(tradesByWorker?.[chipSheet.chip.workerId] ?? []).map((t) => (
                    <CategoryChip key={t.categoryId} code={t.code} label={t.nameTh} />
                  ))}
                </div>
              </div>
            ) : null}

            {chipInCrew ? (
              <>
                {!chipIsPayExempt && !chipSheet.chip.isTeamLead ? (
                  <button
                    type="button"
                    disabled={busy}
                    className={SHEET_ACTION}
                    onClick={() =>
                      run(
                        () =>
                          setCrewLead({
                            crewId: chipSheet.team.id,
                            workerId: chipSheet.chip.workerId,
                            revalidate: teamHref,
                          }),
                        "ตั้งหัวหน้าทีมแล้ว",
                      )
                    }
                  >
                    <Star aria-hidden className="text-ink-secondary size-4" /> ตั้งเป็นหัวหน้าทีม
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  className={SHEET_DANGER}
                  onClick={() =>
                    run(
                      () =>
                        removeWorkerFromCrew({
                          crewId: chipSheet.team.id,
                          workerId: chipSheet.chip.workerId,
                          revalidate: teamHref,
                        }),
                      "นำออกจากทีมแล้ว",
                    )
                  }
                >
                  นำออกจากทีม
                </button>
              </>
            ) : null}

            {chipIsPayExempt ? null : otherCrews(chipSheet.team.id).length > 0 ? (
              <>
                <p className="text-ink-secondary mt-1 text-xs">
                  {chipSheet.team.kind === "crew" ? "ย้ายไปทีม" : "เพิ่มเข้าทีม"}
                </p>
                {otherCrews(chipSheet.team.id).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    className={SHEET_ACTION}
                    onClick={() =>
                      run(
                        () =>
                          chipSheet.team.kind === "crew"
                            ? moveWorkerBetweenCrews({
                                fromCrewId: chipSheet.team.id,
                                toCrewId: t.id,
                                workerId: chipSheet.chip.workerId,
                                revalidate: teamHref,
                              })
                            : addWorkerToCrew({
                                crewId: t.id,
                                workerId: chipSheet.chip.workerId,
                                revalidate: teamHref,
                              }),
                        chipSheet.team.kind === "crew" ? "ย้ายทีมแล้ว" : "เพิ่มเข้าทีมแล้ว",
                      )
                    }
                  >
                    {t.name}
                  </button>
                ))}
              </>
            ) : (
              <p className="text-ink-muted text-xs">ยังไม่มีทีมอื่นให้ย้ายไป</p>
            )}
            <Link className={SHEET_ACTION} href="/workers">
              แก้ไขสายงานที่รายชื่อช่าง
            </Link>
            {error ? <p className={INLINE_ERROR}>{error}</p> : null}
          </div>
        ) : null}
      </BottomSheet>

      {/* ── U6: assigned plan-chip actions ─────────────────────────────── */}
      <BottomSheet
        open={sheet?.type === "planChip"}
        title={sheet?.type === "planChip" ? `${sheet.entry.item.code} · ${sheet.team.name}` : ""}
        onClose={closeSheet}
      >
        {sheet?.type === "planChip" ? (
          <div className="flex flex-col gap-2">
            <p className="text-ink-secondary text-xs">{sheet.entry.item.name}</p>
            {(() => {
              const mm = tradeMismatchCode(
                sheet.entry.item.categoryCode,
                leadTradesOf(sheet.team, tradesByWorker),
              );
              return mm ? (
                <p className="text-ink-muted flex items-center gap-1.5 text-xs">
                  <CategoryChip code={mm} /> {TRADE_MISMATCH_HINT}
                </p>
              ) : null;
            })()}
            {sheet.entry.mixed ? (
              // The SA hand-tuned this item's workers on /sa/plan — team-grain
              // writes would clobber it (full-replace RPC), so none are offered.
              <p className="text-ink-secondary text-sm">
                งานนี้จัดคนรายบุคคลไว้ — แก้ได้ที่{" "}
                <Link className="text-action underline" href="/sa/plan">
                  แผนงาน
                </Link>
              </p>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className={SHEET_ACTION}
                  onClick={() => {
                    const item = sheet.entry.item;
                    closeSheet();
                    setPlacing(item);
                  }}
                >
                  <MapPin aria-hidden className="text-ink-secondary size-4" /> ย้ายไปทีมอื่น
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={SHEET_ACTION}
                  onClick={() =>
                    run(
                      () => setDailyPlanItemCrew(sheet.entry.item.itemId, [], null),
                      "เอางานออกจากทีมแล้ว",
                    )
                  }
                >
                  เอาออกจากทีม
                </button>
              </>
            )}
            <Link
              className={SHEET_ACTION}
              href={`/projects/${projectId}/work-packages/${sheet.entry.item.workPackageId}`}
            >
              เปิดหน้างาน
            </Link>
            {error ? <p className={INLINE_ERROR}>{error}</p> : null}
          </div>
        ) : null}
      </BottomSheet>

      {/* ── U6: เพิ่มงานเข้าแผน ─────────────────────────────────────────── */}
      <BottomSheet
        open={sheet?.type === "addPlanWp"}
        title={`เพิ่มงานเข้าแผน${day === "today" ? "วันนี้" : "พรุ่งนี้"}`}
        onClose={closeSheet}
      >
        <div className="flex flex-col gap-2">
          {/* WPs already on the selected day's board are hidden: re-adding is
              an on-conflict no-op that would still toast success (fresh-eyes). */}
          {(() => {
            const onBoard = new Set(
              (dayPlans ? dayPlans[day].items : []).map((i) => i.workPackageId),
            );
            const offerable = (planWps ?? []).filter((wp) => !onBoard.has(wp.id));
            return (
              <>
                {offerable.map((wp) => (
                  <button
                    key={wp.id}
                    type="button"
                    disabled={busy}
                    className={SHEET_ACTION}
                    onClick={() => {
                      if (!planDate) return;
                      run(
                        () => addDailyPlanItem(projectId, planDate, wp.id),
                        "เพิ่มงานเข้าแผนแล้ว",
                      );
                    }}
                  >
                    <span className="font-medium">{wp.code}</span>
                    <span className="text-ink-secondary min-w-0 flex-1 truncate text-xs">
                      {wp.name}
                    </span>
                  </button>
                ))}
                {offerable.length === 0 ? (
                  <p className="text-ink-muted text-xs">ไม่มีงานให้เพิ่ม</p>
                ) : null}
              </>
            );
          })()}
          {error ? <p className={INLINE_ERROR}>{error}</p> : null}
        </div>
      </BottomSheet>

      {/* ── ⓘ role explainers (U5) ──────────────────────────────────────── */}
      <BottomSheet
        open={sheet?.type === "info"}
        title={
          sheet?.type === "info"
            ? sheet.tier === "crew"
              ? "บทบาท — ทีมภายใน"
              : sheet.tier === "firm"
                ? "บทบาท — ทีมภายนอก"
                : "บทบาท — สนับสนุน"
            : ""
        }
        onClose={closeSheet}
      >
        {sheet?.type === "info" ? (
          <div className="flex flex-col gap-3">
            {(sheet.tier === "management"
              ? [...TEAM_MAP_ROLE_HELP.management, ...TEAM_MAP_ROLE_HELP.site]
              : TEAM_MAP_ROLE_HELP[sheet.tier === "firm" ? "crew" : sheet.tier]
            ).map((entry) => (
              <div key={entry.label}>
                <p className="text-ink text-sm font-medium">{entry.label}</p>
                <p className="text-ink-secondary text-xs">{entry.description}</p>
              </div>
            ))}
          </div>
        ) : null}
      </BottomSheet>

      {/* ── ตั้งทีมใหม่ ───────────────────────────────────────────────────── */}
      <BottomSheet open={sheet?.type === "createCrew"} title="ตั้งทีมใหม่" onClose={closeSheet}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-ink-secondary text-xs">ชื่อทีม</span>
            <input
              type="text"
              aria-label="ชื่อทีม"
              maxLength={80}
              value={crewName}
              onChange={(e) => setCrewName(e.target.value)}
              className="border-edge bg-card text-ink min-h-11 rounded-lg border px-3 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            className={SHEET_PRIMARY}
            onClick={() =>
              run(
                () => createCrew({ projectId, name: crewName, revalidate: teamHref }),
                "ตั้งทีมแล้ว",
              )
            }
          >
            สร้างทีม
          </button>
          {error ? <p className={INLINE_ERROR}>{error}</p> : null}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirmDissolve !== null}
        message={
          confirmDissolve
            ? `ยุบทีม “${confirmDissolve.name}”?\nสมาชิกจะกลับไปอยู่ในกลุ่มยังไม่จัดทีม`
            : ""
        }
        confirmLabel="ยืนยันยุบทีม"
        onConfirm={() => {
          const team = confirmDissolve;
          setConfirmDissolve(null);
          if (team) {
            run(() => dissolveCrew({ crewId: team.id, revalidate: teamHref }), "ยุบทีมแล้ว");
          }
        }}
        onCancel={() => setConfirmDissolve(null)}
      />

      <ConfirmDialog
        open={confirmSelfRemove !== null}
        message={
          "นำตัวเองออกจากทีมโครงการนี้?\nคุณจะไม่เห็นโครงการนี้อีก จนกว่าจะมีผู้จัดการเพิ่มคุณกลับเข้าทีม"
        }
        confirmLabel="นำตัวเองออก"
        onConfirm={() => {
          const node = confirmSelfRemove;
          setConfirmSelfRemove(null);
          if (node) run(() => removeProjectMember(projectId, node.userId), "นำออกจากทีมแล้ว");
        }}
        onCancel={() => setConfirmSelfRemove(null)}
      />
    </div>
  );
}
