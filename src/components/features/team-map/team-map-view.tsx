"use client";

// Spec 330 U1 — the per-project team map (ทีมงานโครงการ). Three tiers:
// ผู้บริหารโครงการ → หน้างาน → ทีมช่าง. Team-card member lists collapse per
// card + a master toggle; counts stay visible collapsed (operator requirement).
// U1 manage surface = STAFF only (add / remove / set-primary over the existing
// spec-80/292 actions); worker chips are read-only until U3 wires the crew RPCs.
// 'use client': collapse state, sheet state, and action relays live here.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CircleHelp, Star, UserPlus, Users } from "lucide-react";

import {
  addProjectMember,
  removeProjectMember,
  setPrimaryProjectFor,
} from "@/app/projects/[projectId]/settings/actions";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import type {
  ProjectTeamMap,
  TeamMapStaffNode,
  TeamMapTeamCard,
} from "@/lib/team-map/build-team-map";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { evaluateMemberRemoval } from "@/lib/projects/member-removal";
import { useToast } from "@/lib/ui/use-toast";

export interface AddableStaff {
  id: string;
  name: string | null;
  role: string;
}

type SheetState = { type: "staff"; node: TeamMapStaffNode } | { type: "add" } | null;

const TIER_HEADING = "text-ink-secondary text-xs font-medium";
const CARD = "rounded-card border-edge bg-card flex flex-col gap-2 border px-3 py-2";
const STAFF_ROW =
  "rounded-card border-edge bg-card flex min-h-11 w-full items-center gap-3 border px-3 py-2 text-left";
const BADGE =
  "bg-sunk text-ink-secondary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium";
const CHIP = "bg-sunk text-ink rounded-full px-2.5 py-1 text-xs";
const TOGGLE = "text-action min-h-11 shrink-0 px-2 text-xs font-medium";
const SHEET_ACTION =
  "border-edge text-ink flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm";

function roleLabel(role: string): string {
  return (USER_ROLE_LABEL as Record<string, string>)[role] ?? role;
}

function StaffRow({ node, onOpen }: { node: TeamMapStaffNode; onOpen: () => void }) {
  return (
    <button type="button" className={STAFF_ROW} onClick={onOpen}>
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

function TeamCard({
  team,
  expanded,
  onToggle,
}: {
  team: TeamMapTeamCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = team.kind === "firm" ? Building2 : team.kind === "unassigned" ? CircleHelp : Users;
  const subtitle =
    team.kind === "firm"
      ? `ผู้รับเหมา · ${team.count} คน · เบิกจ่ายผ่านหัวหน้าทีม`
      : team.kind === "unassigned"
        ? `${team.count} คน`
        : `ทีม PRC · ${team.count} คน`;
  return (
    <div
      data-testid={`team-card-${team.id}`}
      className={`${CARD} ${team.kind === "unassigned" ? "border-dashed" : ""}`}
    >
      <div className="flex items-center gap-3">
        <Icon aria-hidden className="text-ink-secondary size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-sm font-medium">{team.name}</span>
          <span className="text-ink-secondary block text-xs">{subtitle}</span>
        </span>
        <button type="button" className={TOGGLE} onClick={onToggle}>
          {expanded ? "ซ่อน" : "แสดง"}
        </button>
      </div>
      {expanded ? (
        <div className="border-edge flex flex-wrap gap-1.5 border-t pt-2">
          {team.members.map((m) => (
            <span key={m.workerId} className={CHIP}>
              {m.isTeamLead ? (
                <span className="text-ink inline-flex items-center gap-1 font-medium">
                  <Star aria-hidden className="size-3" /> {m.name} · หัวหน้าทีม
                </span>
              ) : (
                m.name
              )}
            </span>
          ))}
          {team.members.length === 0 ? (
            <span className="text-ink-muted text-xs">ยังไม่มีสมาชิก</span>
          ) : null}
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
}: {
  projectId: string;
  map: ProjectTeamMap;
  addableStaff: AddableStaff[];
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSelfRemove, setConfirmSelfRemove] = useState<TeamMapStaffNode | null>(null);

  const allExpanded = map.teams.length > 0 && map.teams.every((t) => expanded.has(t.id));

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
      <section aria-label="ผู้บริหารโครงการ">
        <p className={`${TIER_HEADING} mb-2`}>ผู้บริหารโครงการ · {map.management.length} คน</p>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:justify-center sm:[&>button]:min-w-56 sm:[&>button]:flex-none">
          {map.management.map((n) => (
            <StaffRow key={n.userId} node={n} onOpen={() => setSheet({ type: "staff", node: n })} />
          ))}
          {map.management.length === 0 ? (
            <p className="text-ink-muted text-xs">ยังไม่มีผู้บริหารในทีม</p>
          ) : null}
        </div>
      </section>

      <div className="border-edge-strong ml-4 h-3 border-l sm:mx-auto" aria-hidden />

      <section aria-label="หน้างาน">
        <p className={`${TIER_HEADING} mb-2`}>หน้างาน · {map.site.length} คน</p>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:justify-center sm:[&>button]:min-w-56 sm:[&>button]:flex-none">
          {map.site.map((n) => (
            <StaffRow key={n.userId} node={n} onOpen={() => setSheet({ type: "staff", node: n })} />
          ))}
          {map.site.length === 0 ? (
            <p className="text-ink-muted text-xs">ยังไม่มีทีมหน้างาน</p>
          ) : null}
        </div>
      </section>

      <div className="border-edge-strong ml-4 h-3 border-l sm:mx-auto" aria-hidden />

      <section aria-label="ทีมช่าง">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className={TIER_HEADING}>
            ทีมช่าง · รวม {map.crewTotal} คน · {map.teamCount} ทีม
          </p>
          {map.teams.length > 0 ? (
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
          {map.teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              expanded={expanded.has(t.id)}
              onToggle={() => toggle(t.id)}
            />
          ))}
          {map.teams.length === 0 ? (
            <p className="text-ink-muted text-xs">ยังไม่มีช่างในโครงการ</p>
          ) : null}
        </div>
      </section>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="text-action border-edge flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium"
          onClick={() => setSheet({ type: "add" })}
        >
          <UserPlus aria-hidden className="size-4" /> เพิ่มสมาชิก
        </button>
      </div>

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
                className={SHEET_ACTION}
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

      <BottomSheet open={sheet?.type === "add"} title="เพิ่มสมาชิกทีมโครงการ" onClose={closeSheet}>
        <div className="flex flex-col gap-2">
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
