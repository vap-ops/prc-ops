"use client";

// Spec 306 U3 — the muster cockpit. At the morning talk the SA forms teams behind
// their หัวหน้า and checks members in (and out in the evening). One screen, a
// เข้า/ออก mode toggle. Attendance is recorded through the muster RPCs (scan-in =
// presence + team membership; the WP set = the Site Owner's announcement). The QR
// camera (BarcodeDetector) is an accelerator; manual tap-add is always present so a
// lost/phoneless badge is never "absent". Money (labor cost) is derived later at
// ปิดวัน (U5) — this screen never touches it.

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatThaiDate, MUSTER_DAY_CLOSED_LABEL } from "@/lib/i18n/labels";
import {
  openMusterTeam,
  musterScan,
  setMusterTeamWps,
  closeMusterDay,
  moveMusterWorker,
} from "@/lib/muster/actions";
import { groupMusterWps } from "@/lib/muster/wp-groups";
import { hasScannerSupport } from "@/lib/muster/scanner-support";
import { deriveCloseDayState } from "@/lib/muster/close-day-state";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import type { MusterWp } from "@/lib/muster/wp-groups";
import type { MusterBoard, MusterTeam } from "@/lib/muster/load-muster";
import { MusterCamera } from "./muster-camera";

type Mode = "in" | "out";
type Session = "regular" | "ot";

function bangkokTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

const TOGGLE_ON = "bg-fill text-on-fill";
const TOGGLE_OFF = "bg-sunk text-ink-secondary";
const CHIP = "bg-sunk text-ink-secondary text-meta rounded-full px-2.5 py-1 font-semibold";

// Spec 306 discoverability — the ปิดวัน bar buttons. `PRIMARY` is the positive
// finalize action (closing the day books wages); it is deliberately NOT bg-danger
// — the old danger-red confirm read as destructive and made SAs hesitate.
const BAR_BTN = "min-h-11 rounded-lg px-4 text-sm font-bold disabled:opacity-50";
const BAR_PRIMARY = `bg-fill text-on-fill ${BAR_BTN}`;
const BAR_SUNK = `bg-sunk text-ink ${BAR_BTN}`;

// Client-only feature detection. useSyncExternalStore keeps SSR + hydration
// snapshots false, then reads the real value on the client — hydration-safe and
// without a setState-in-effect (react-hooks/set-state-in-effect). Spec 306 U3b:
// the gate is overall scanner support (native BarcodeDetector OR the jsQR
// camera fallback), so the button now renders on iOS too.
const subscribeNoop = () => () => {};

export function MusterCockpit({
  projectId,
  date,
  revalidate,
  board,
  htWorkerIds,
  pastDayEnd,
}: {
  projectId: string;
  date: string;
  revalidate: string;
  board: MusterBoard;
  /** Spec 334 follow-up — the HT axis (crews.lead_worker_id, spec 330/332): only
   * these workers may be picked as a muster team's หัวหน้าทีม. */
  htWorkerIds: readonly string[];
  /** Spec 306 discoverability — server-computed "is it past 17:00 Asia/Bangkok?"
   * (a snapshot at page load), the overdue-reminder trigger for the ปิดวัน bar. */
  pastDayEnd: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("in");
  // Spec 351 — งานปกติ (regular) vs OT session. OT scans derive in/out per worker
  // (no OT row → in, open OT → out), so the เข้า/ออก toggle is only shown for regular.
  const [session, setSession] = useState<Session>("regular");
  const [leadPick, setLeadPick] = useState("");
  const [scanTeamId, setScanTeamId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pending, startTransition] = useTransition();
  const hasCamera = useSyncExternalStore(subscribeNoop, hasScannerSupport, () => false);

  const musteredIds = new Set(board.teams.flatMap((t) => t.members.map((m) => m.workerId)));
  const leadIds = new Set(board.teams.map((t) => t.leadWorkerId));
  // หัวหน้าทีม = HT only (operator rule 2026-07-21): a worker who leads a crew
  // (htWorkerIds, from crews.lead_worker_id) and is not already leading today.
  // pickableHts intersects with the ACTIVE roster — a deactivated crew lead must
  // trigger the guidance below, not a dead picker (fresh-eyes 334fix).
  const htIds = new Set(htWorkerIds);
  const pickableHts = board.workers.filter((w) => htIds.has(w.id));
  const availableLeads = pickableHts.filter((w) => !leadIds.has(w.id));
  // A worker is addable to team T if not already mustered AND not the lead of
  // ANOTHER team (their own lead may be scanned into their own team). Excluding
  // all leadIds globally would wrongly block adding a lead to their own team.
  const addableTo = (teamId: string) => {
    const otherLeads = new Set(
      board.teams.filter((t) => t.id !== teamId).map((t) => t.leadWorkerId),
    );
    return board.workers.filter((w) => !musteredIds.has(w.id) && !otherLeads.has(w.id));
  };

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setMessage(res.error ?? "เช็คชื่อไม่สำเร็จ");
      else {
        setMessage(null);
        router.refresh();
      }
    });
  }

  const openTeam = () => {
    if (!leadPick) return;
    run(async () => {
      const res = await openMusterTeam({ projectId, date, leadWorkerId: leadPick, revalidate });
      if (res.ok) setLeadPick("");
      return res;
    });
  };

  // Spec 351 — a regular scan follows the เข้า/ออก mode; an OT scan derives its
  // in/out from the worker's current OT state (no OT row → in, open OT → out).
  const scanRegular = (teamId: string, workerId: string, method: "qr" | "manual") =>
    run(() => musterScan({ teamId, workerId, mode, method, session: "regular", revalidate }));
  const scanOt = (teamId: string, workerId: string, method: "qr" | "manual") => {
    const member = board.teams
      .find((t) => t.id === teamId)
      ?.members.find((m) => m.workerId === workerId);
    // OT already closed for this worker → nothing to scan. The per-member buttons
    // already hide in this state; the camera path must match (else a QR scan would
    // fire an idempotent no-op scan-in with no feedback to the SA).
    if (member?.ot && member.ot.outAt) {
      setMessage("ช่างคนนี้ปิด OT แล้ว");
      return;
    }
    const otMode: Mode = member?.ot && !member.ot.outAt ? "out" : "in";
    run(() => musterScan({ teamId, workerId, mode: otMode, method, session: "ot", revalidate }));
  };
  // The camera dispatches by the active session (it scans whichever session is on).
  const scanFromCamera = (teamId: string, workerId: string) =>
    session === "ot" ? scanOt(teamId, workerId, "qr") : scanRegular(teamId, workerId, "qr");

  const saveWps = (teamId: string, wpIds: string[]) =>
    run(() => setMusterTeamWps({ teamId, wpIds, revalidate }));

  // Spec 306 move UI — day-of correction: reassign a member's attendance to
  // another team (same date; the RPC guards project + date + existence).
  const move = (workerId: string, toTeamId: string) =>
    run(() => moveMusterWorker({ workerId, date, toTeamId, revalidate }));

  const closeDay = () => {
    setConfirmClose(false);
    run(() => closeMusterDay({ projectId, date, revalidate }));
  };

  // Spec 306 discoverability — the ปิดวัน bar's state (calm / ready / overdue /
  // closed) drives its highlight and copy; a fixed footer keeps it in view no
  // matter where the SA has scrolled (the old buried bottom button was missed
  // on 2026-07-24 → the day never closed → the derive never ran).
  const closeState = deriveCloseDayState({
    teams: board.teams,
    closure: board.closure,
    pastDayEnd,
  });

  return (
    // pb clears the fixed ปิดวัน footer so the last team card is never hidden.
    <div className="flex flex-col gap-4 pb-40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink font-semibold">{formatThaiDate(date)}</p>
        <div className="flex items-center gap-2">
          {/* Spec 351 — session toggle: normal hours vs OT. */}
          <div className="flex overflow-hidden rounded-full">
            <button
              type="button"
              onClick={() => setSession("regular")}
              className={`min-h-11 px-4 text-sm font-bold ${session === "regular" ? TOGGLE_ON : TOGGLE_OFF}`}
            >
              งานปกติ
            </button>
            <button
              type="button"
              onClick={() => setSession("ot")}
              className={`min-h-11 px-4 text-sm font-bold ${session === "ot" ? TOGGLE_ON : TOGGLE_OFF}`}
            >
              OT
            </button>
          </div>
          {/* เข้า/ออก applies to the regular session only — OT derives in/out per worker. */}
          {session === "regular" ? (
            <div className="flex overflow-hidden rounded-full">
              <button
                type="button"
                onClick={() => setMode("in")}
                className={`min-h-11 px-4 text-sm font-bold ${mode === "in" ? TOGGLE_ON : TOGGLE_OFF}`}
              >
                เข้า
              </button>
              <button
                type="button"
                onClick={() => setMode("out")}
                className={`min-h-11 px-4 text-sm font-bold ${mode === "out" ? TOGGLE_ON : TOGGLE_OFF}`}
              >
                ออก
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {message ? (
        <p role="alert" className="bg-danger-soft text-danger-ink rounded-card px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      {pickableHts.length === 0 ? (
        // No pickable HT on the active roster — an empty opener would be a dead
        // door. Copy is scoped honestly: setting an HT happens on the project
        // team map and (contractor wall, mig 075818) works for PRC ช่าง only —
        // never point a subcon-only project at an action the DB refuses.
        <p className="border-edge bg-sunk text-ink-secondary rounded-card border px-3 py-2 text-sm">
          ยังไม่มีหัวหน้าทีม (HT) ในโครงการนี้ — ให้ผู้จัดการกำหนดหัวหน้าทีมที่หน้าทีมงานโครงการก่อน
          (กำหนดได้เฉพาะช่าง PRC)
        </p>
      ) : (
        <div className="border-edge bg-card rounded-card flex flex-wrap items-center gap-2 border px-4 py-3">
          <select
            aria-label="เลือกหัวหน้าทีม"
            value={leadPick}
            onChange={(e) => setLeadPick(e.target.value)}
            className="border-edge bg-card text-ink min-h-11 flex-1 rounded-lg border px-3 text-sm"
          >
            <option value="">เลือกหัวหน้าทีม…</option>
            {availableLeads.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={openTeam}
            disabled={!leadPick || pending}
            className="bg-fill text-on-fill min-h-11 rounded-lg px-4 text-sm font-bold disabled:opacity-50"
          >
            เปิดทีม
          </button>
        </div>
      )}

      {board.teams.length === 0 ? (
        <p className="text-ink-muted text-sm">ยังไม่มีทีมวันนี้ — เลือกหัวหน้าทีมเพื่อเปิดทีมแรก</p>
      ) : (
        board.teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            wps={board.wps}
            mode={mode}
            session={session}
            pending={pending}
            availableToAdd={addableTo(team.id)}
            otherTeams={board.teams
              .filter((t) => t.id !== team.id)
              .map((t) => ({ id: t.id, leadName: t.leadName }))}
            hasCamera={hasCamera}
            onScan={scanRegular}
            onScanOt={scanOt}
            onSaveWps={saveWps}
            onMove={move}
            onOpenCamera={() => setScanTeamId(team.id)}
          />
        ))
      )}

      {/* Spec 306 discoverability — the ปิดวัน action, pinned to the bottom so it
          follows the SA to wherever the last check-out happened. State-aware:
          calm while workers are in, PRIMARY the moment everyone is out (the day
          is "done" and wages can be booked), amber past day-end, closed after. */}
      {board.teams.length > 0 ? (
        <div className="border-edge bg-card shadow-up fixed inset-x-0 bottom-0 z-40 border-t px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-2`}>
            {closeState.kind === "ready" ? (
              <p className="text-ink text-sm font-semibold">
                ทุกคนเช็คออกแล้ว · ปิดวันเพื่อบันทึกค่าแรง
              </p>
            ) : closeState.kind === "overdue" ? (
              <p className="text-attn-ink text-sm font-semibold">
                เลยเวลาเลิกงานแล้ว · อย่าลืมปิดวัน
              </p>
            ) : closeState.kind === "closed" ? (
              <p className="text-ink-secondary text-sm font-semibold">
                {MUSTER_DAY_CLOSED_LABEL} · {bangkokTime(closeState.closedAt)}
              </p>
            ) : (
              <p className="text-ink-secondary text-sm">ยังมีช่างในงาน {closeState.stillIn} คน</p>
            )}

            {confirmClose ? (
              <>
                {closeState.openOt > 0 ? (
                  <p className="text-attn-ink text-meta">
                    มีช่าง {closeState.openOt} คนยัง OT ไม่ปิด — ปิดวันจะไม่บันทึก OT ของพวกเขา
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeDay}
                    disabled={pending}
                    className={`flex-1 ${BAR_PRIMARY}`}
                  >
                    ยืนยันปิดวัน
                  </button>
                  <button type="button" onClick={() => setConfirmClose(false)} className={BAR_SUNK}>
                    ยกเลิก
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClose(true)}
                disabled={pending}
                className={`w-full ${closeState.kind === "ready" || closeState.kind === "overdue" ? BAR_PRIMARY : BAR_SUNK}`}
              >
                {closeState.kind === "closed" ? "ปิดวันอีกครั้ง" : "ปิดวัน"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {scanTeamId ? (
        <MusterCamera
          onDetected={(workerId) => {
            scanFromCamera(scanTeamId, workerId);
            setScanTeamId(null);
          }}
          onClose={() => setScanTeamId(null)}
        />
      ) : null}
    </div>
  );
}

function TeamCard({
  team,
  wps,
  mode,
  session,
  pending,
  availableToAdd,
  otherTeams,
  hasCamera,
  onScan,
  onScanOt,
  onSaveWps,
  onMove,
  onOpenCamera,
}: {
  team: MusterTeam;
  wps: MusterWp[];
  mode: Mode;
  session: Session;
  pending: boolean;
  availableToAdd: { id: string; name: string }[];
  /** Spec 306 move UI — the OTHER teams today (move targets, by lead name). */
  otherTeams: { id: string; leadName: string }[];
  hasCamera: boolean;
  /** Regular-session scan (add / check-out), following the เข้า/ออก mode. */
  onScan: (teamId: string, workerId: string, method: "qr" | "manual") => void;
  /** Spec 351 — OT-session scan (in/out derived per worker from their OT state). */
  onScanOt: (teamId: string, workerId: string, method: "qr" | "manual") => void;
  onSaveWps: (teamId: string, wpIds: string[]) => void;
  onMove: (workerId: string, toTeamId: string) => void;
  onOpenCamera: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set(team.wpIds));
  // Spec 306 grain-coverage — which parent งาน groups are expanded in the picker.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Spec 306 move UI — which member's move picker is open (one at a time).
  const [movePickFor, setMovePickFor] = useState<string | null>(null);

  // The leaf WPs folded into collapsible groups by parent งาน (spec 306 grain-coverage).
  const wpGroups = groupMusterWps(wps);

  const openEditor = () => {
    setChecked(new Set(team.wpIds));
    // Open the groups that already hold a checked child so current picks are visible.
    setExpanded(
      new Set(
        wpGroups
          .filter((g) => g.parentId !== null && g.children.some((c) => team.wpIds.includes(c.id)))
          .map((g) => g.parentId as string),
      ),
    );
    setEditOpen((v) => !v);
  };
  const toggleWp = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const wpById = new Map(wps.map((w) => [w.id, w]));

  return (
    <section data-testid={`team-${team.id}`} className="border-edge bg-card rounded-card border">
      <div className="border-edge flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="bg-brand text-on-brand text-meta rounded-full px-2 py-0.5 font-bold">
            หัวหน้า
          </span>
          <span className="text-ink font-semibold">{team.leadName}</span>
        </div>
        <span className="text-ink-muted text-meta">{team.members.length} คน</span>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {team.wpIds.length ? (
            team.wpIds.map((id) => (
              <span key={id} className={CHIP}>
                {wpById.get(id)?.code ?? "?"}
              </span>
            ))
          ) : (
            <span className="text-ink-muted text-meta">ยังไม่ระบุงาน</span>
          )}
          <button
            type="button"
            onClick={openEditor}
            className="text-accent text-meta font-semibold underline"
          >
            แก้ไขงาน
          </button>
        </div>

        {editOpen ? (
          <div className="border-edge bg-sunk rounded-lg border p-3">
            <div className="flex flex-col gap-2">
              {wpGroups.map((g) => {
                const row = (wp: MusterWp) => (
                  <label key={wp.id} className="text-ink flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked.has(wp.id)}
                      onChange={() => toggleWp(wp.id)}
                    />
                    <span>
                      {wp.code} {wp.name}
                    </span>
                  </label>
                );
                // Standalone leaf main-WPs (no parent งาน) render directly.
                if (g.parentId === null) return g.children.map(row);
                const pickedInGroup = g.children.filter((c) => checked.has(c.id)).length;
                const isOpen = expanded.has(g.parentId);
                return (
                  <div key={g.parentId} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.parentId!)}
                      aria-expanded={isOpen}
                      className="text-ink flex min-h-11 items-center gap-2 text-left text-sm font-semibold"
                    >
                      <span aria-hidden className="text-ink-muted">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span>
                        {g.parentCode} {g.parentName}
                      </span>
                      {pickedInGroup > 0 ? (
                        <span className="text-accent text-meta">· เลือก {pickedInGroup}</span>
                      ) : null}
                    </button>
                    {isOpen ? (
                      <div className="flex flex-col gap-2 pl-5">{g.children.map(row)}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                // Persist only ids that are still selectable leaves — an id stuck in
                // team.wpIds that no longer renders (a legacy/group WP from the old
                // main-WP picker) has no checkbox to clear, so drop it here rather
                // than re-persist a binding the SA cannot see or remove.
                onSaveWps(
                  team.id,
                  [...checked].filter((id) => wpById.has(id)),
                );
                setEditOpen(false);
              }}
              disabled={pending}
              className="bg-fill text-on-fill mt-3 min-h-11 rounded-lg px-3 text-sm font-bold disabled:opacity-50"
            >
              บันทึกงาน
            </button>
          </div>
        ) : null}

        <ul className="flex flex-col gap-1.5">
          {team.members.map((m) => (
            <li key={m.workerId} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink text-sm">{m.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-ink-muted text-meta tabular-nums">
                    {bangkokTime(m.inAt)}
                    {m.outAt ? ` – ${bangkokTime(m.outAt)}` : ""}
                    {m.outAt && m.outAuto ? " (อัตโนมัติ)" : ""}
                  </span>
                  {session === "regular" ? (
                    <>
                      {/* Spec 306 move UI — day-of correction, เข้า mode, only when
                          there is another team to move to. */}
                      {mode === "in" && otherTeams.length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setMovePickFor((v) => (v === m.workerId ? null : m.workerId))
                          }
                          disabled={pending}
                          className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                        >
                          ย้าย
                        </button>
                      ) : null}
                      {mode === "out" && m.inAt && !m.outAt ? (
                        <button
                          type="button"
                          onClick={() => onScan(team.id, m.workerId, "manual")}
                          disabled={pending}
                          className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                        >
                          เช็คออก
                        </button>
                      ) : null}
                    </>
                  ) : !m.ot ? (
                    // Spec 351 — OT session: no OT row yet → open one (OT เข้า).
                    <button
                      type="button"
                      onClick={() => onScanOt(team.id, m.workerId, "manual")}
                      disabled={pending}
                      className="bg-fill text-on-fill min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                    >
                      OT เข้า
                    </button>
                  ) : !m.ot.outAt ? (
                    // OT open → close it (OT ออก).
                    <button
                      type="button"
                      onClick={() => onScanOt(team.id, m.workerId, "manual")}
                      disabled={pending}
                      className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                    >
                      OT ออก
                    </button>
                  ) : null}
                </div>
              </div>
              {/* Spec 351 — the worker's OT session: its window + an open-OT flag
                  (surfaced whenever there is an OT row, in either session view). */}
              {m.ot ? (
                <div className="flex items-center gap-2">
                  <span className="text-accent text-meta tabular-nums">
                    OT {bangkokTime(m.ot.inAt)}
                    {m.ot.outAt ? ` – ${bangkokTime(m.ot.outAt)}` : ""}
                    {m.ot.otHours != null ? ` · ${m.ot.otHours} ชม.` : ""}
                  </span>
                  {m.ot.inAt && !m.ot.outAt ? (
                    <span className="bg-attn-soft text-attn-ink text-meta rounded-full px-2 py-0.5 font-semibold">
                      OT ยังไม่ปิด
                    </span>
                  ) : null}
                </div>
              ) : null}
              {/* Picker gated on เข้า mode + regular session — the toggle hides on
                  a flip but this open panel would otherwise survive it live. */}
              {session === "regular" && mode === "in" && movePickFor === m.workerId ? (
                <div className="border-edge bg-sunk flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <span className="text-ink-muted text-meta">ย้ายไปทีมของ:</span>
                  {otherTeams.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        onMove(m.workerId, t.id);
                        setMovePickFor(null);
                      }}
                      disabled={pending}
                      className="bg-card text-ink border-edge min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50"
                    >
                      {t.leadName}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {session === "regular" && mode === "in" ? (
          <div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAddOpen((v) => !v)}
                className="bg-sunk text-ink min-h-11 rounded-lg px-3 text-sm font-bold"
              >
                + เพิ่มช่าง
              </button>
              {hasCamera ? (
                <button
                  type="button"
                  onClick={onOpenCamera}
                  className="bg-fill text-on-fill min-h-11 rounded-lg px-3 text-sm font-bold"
                >
                  สแกน QR
                </button>
              ) : null}
            </div>
            {addOpen ? (
              <div className="border-edge bg-sunk mt-2 flex flex-wrap gap-2 rounded-lg border p-2">
                {availableToAdd.length ? (
                  availableToAdd.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => onScan(team.id, w.id, "manual")}
                      disabled={pending}
                      className="bg-card text-ink border-edge min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50"
                    >
                      {w.name}
                    </button>
                  ))
                ) : (
                  <span className="text-ink-muted text-meta">ช่างทุกคนเข้าทีมแล้ว</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Spec 351 — OT session: OT is opened/closed per member above; the camera
            is an optional accelerator (it scans into whichever session is active). */}
        {session === "ot" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-muted text-meta">
              แตะ OT เข้า / OT ออก ที่ชื่อช่างเพื่อบันทึกช่วง OT
            </span>
            {hasCamera ? (
              <button
                type="button"
                onClick={onOpenCamera}
                className="bg-fill text-on-fill min-h-11 rounded-lg px-3 text-sm font-bold"
              >
                สแกน QR
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
