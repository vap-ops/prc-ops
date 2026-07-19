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
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { evaluateMemberRemoval } from "@/lib/projects/member-removal";
import { useToast } from "@/lib/ui/use-toast";

export interface AddableStaff {
  id: string;
  name: string | null;
  role: string;
}

// ONE sheet at a time — every surface rides the same union so two dialogs can
// never stack.
type SheetState =
  | { type: "staff"; node: TeamMapStaffNode }
  | { type: "add" }
  | { type: "createCrew" }
  | { type: "team"; team: TeamMapTeamCard }
  | { type: "chip"; chip: TeamMapWorkerChip; team: TeamMapTeamCard }
  | null;

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
  onManage,
  onChip,
}: {
  team: TeamMapTeamCard;
  expanded: boolean;
  onToggle: () => void;
  onManage: () => void;
  onChip: (chip: TeamMapWorkerChip) => void;
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
        {/* SIBLING of the toggle, never a wrapper: a wrapping button would
            swallow the toggle into its accessible name and is invalid HTML —
            the real parser flattens it, so the tap region would exist in jsdom
            and not in the browser. Crew cards only: a firm card's id is a
            contractor uuid and the pool has no crew to manage. */}
        {team.kind === "crew" ? (
          <button type="button" className={TOGGLE} onClick={onManage} aria-label="จัดการทีม">
            จัดการทีม
          </button>
        ) : null}
        <button type="button" className={TOGGLE} onClick={onToggle}>
          {expanded ? "ซ่อน" : "แสดง"}
        </button>
      </div>
      {expanded ? (
        <div className="border-edge flex flex-wrap gap-1.5 border-t pt-2">
          {team.members.map((m) => (
            <button
              key={m.workerId}
              type="button"
              className={`${CHIP} min-h-11`}
              onClick={() => onChip(m)}
            >
              {m.isTeamLead ? (
                <span className="text-ink inline-flex items-center gap-1 font-medium">
                  <Star aria-hidden className="size-3" /> {m.name} · หัวหน้าทีม
                </span>
              ) : (
                m.name
              )}
            </button>
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
  const [confirmDissolve, setConfirmDissolve] = useState<TeamMapTeamCard | null>(null);
  const [crewName, setCrewName] = useState("");

  const allExpanded = map.teams.length > 0 && map.teams.every((t) => expanded.has(t.id));
  const teamHref = `/projects/${projectId}/team`;
  const teamSheet = sheet?.type === "team" ? sheet.team : null;
  const chipSheet = sheet?.type === "chip" ? sheet : null;
  // Move/add targets are CREW cards only — never a firm card (its id is a
  // contractor uuid) and never the pool (id is the string "unassigned").
  const otherCrews = (currentId: string) =>
    map.teams.filter((t) => t.kind === "crew" && t.id !== currentId);

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
              onManage={() => setSheet({ type: "team", team: t })}
              onChip={(chip) => setSheet({ type: "chip", chip, team: t })}
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
          <button
            type="button"
            className={SHEET_ACTION}
            onClick={() => setSheet({ type: "createCrew" })}
          >
            <Users aria-hidden className="text-ink-secondary size-4" /> ตั้งทีมใหม่
          </button>
          <p className="text-ink-secondary mt-1 text-xs">เพิ่มพนักงานเข้าโครงการ</p>
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
                defaultValue={teamSheet.name}
                onChange={(e) => setCrewName(e.target.value)}
                className="border-edge bg-card text-ink min-h-11 rounded-lg border px-3 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              className={SHEET_ACTION}
              onClick={() =>
                run(
                  () =>
                    renameCrew({
                      crewId: teamSheet.id,
                      name: crewName || teamSheet.name,
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
              className={SHEET_ACTION}
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
                Postgres by mig 075818) — no crew operation is offered at all. */}
            {chipSheet.chip.contractorId !== null ? (
              <p className="text-ink-secondary text-sm">
                ช่างของผู้รับเหมา — ผู้รับเหมาเป็นผู้จ่ายค่าแรงเอง จึงจัดเข้าทีมช่างของบริษัทไม่ได้
              </p>
            ) : (
              <>
                {chipSheet.team.kind === "crew" ? (
                  <>
                    {!chipSheet.chip.isTeamLead ? (
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
                        <Star aria-hidden className="text-ink-secondary size-4" />{" "}
                        ตั้งเป็นหัวหน้าทีม
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      className={SHEET_ACTION}
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

                {otherCrews(chipSheet.team.id).length > 0 ? (
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
              </>
            )}
            {error ? <p className={INLINE_ERROR}>{error}</p> : null}
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
              onChange={(e) => setCrewName(e.target.value)}
              className="border-edge bg-card text-ink min-h-11 rounded-lg border px-3 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            className={SHEET_ACTION}
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
