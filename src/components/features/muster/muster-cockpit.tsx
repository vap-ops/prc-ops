"use client";

// Spec 306 U3 — the muster cockpit. At the morning talk the SA forms teams behind
// their หัวหน้า and checks members in (and out in the evening). One screen, a
// เข้า/ออก mode toggle. Attendance is recorded through the muster RPCs (scan-in =
// presence + team membership; the WP set = the Site Owner's announcement). Each
// team card's header carries the QR door (spec 357 U-D) opening the add sheet —
// camera scan where the device supports it, tap-add list always in เข้า mode, so
// a lost/phoneless badge is never "absent". Money (labor cost) is derived later
// at ปิดวัน (U5) — this screen never touches it.

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { formatThaiDate, MUSTER_DAY_CLOSED_LABEL } from "@/lib/i18n/labels";
import {
  openMusterTeam,
  musterScan,
  setMusterTeamWps,
  closeMusterDay,
  moveMusterWorker,
} from "@/lib/muster/actions";
import { groupMusterWps, pickerWps } from "@/lib/muster/wp-groups";
import { hasScannerSupport } from "@/lib/muster/scanner-support";
import { deriveCloseDayState } from "@/lib/muster/close-day-state";
import {
  EMPTY_SWEEP,
  classifyScan,
  isCoolingDown,
  markFailed,
  markMoved,
  recordScan,
  type SweepState,
} from "@/lib/muster/sweep";
import { playScanCue } from "@/lib/muster/scan-cue";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import type { MusterWp } from "@/lib/muster/wp-groups";
import type { MusterBoard, MusterTeam } from "@/lib/muster/load-muster";
import { MusterAddSheet, genderChip } from "./muster-add-sheet";

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
  // Spec 359 U1 — the open sheet's running tally. Reset on every open so a new
  // team never inherits the previous team's list.
  const [sweep, setSweep] = useState<SweepState>(EMPTY_SWEEP);
  // The cooldown clock lives in a REF, not in `sweep`. The decode loop can fire
  // twice inside one tick (every ~180ms while the badge is still in frame) and
  // both handlers would then close over the SAME `sweep`, see an empty lastSeen,
  // and both write — the exact double-scan the cooldown exists to stop. A ref is
  // written synchronously, so the second call in the same tick sees the first.
  const lastSeenRef = useRef<Record<string, number>>({});
  // Spec 359 U3 — the same reasoning one level up: `sweep.addedIds` is a render
  // closure, and the tap path has NO cooldown to cover for it (a deliberate
  // re-tap must answer, not be swallowed). Two taps inside one tick would both
  // read an empty addedThisSweep and both write. Written synchronously here.
  const addedRef = useRef<Set<string>>(new Set());
  // Which sweep a write belongs to. A write is in flight for as long as the
  // network takes, and the SA can close the sheet (or open another team's) in
  // that window — at which point `sweep` and `addedRef` are BOTH new. Without
  // this, a late refusal would release an id the CURRENT sweep legitimately
  // added, brand the wrong row failed, or — if the sheet is gone entirely —
  // vanish, leaving a worker un-checked-in with no message anywhere.
  const sweepGenRef = useRef(0);
  const [pending, startTransition] = useTransition();
  const hasCamera = useSyncExternalStore(subscribeNoop, hasScannerSupport, () => false);

  const leadIds = new Set(board.teams.map((t) => t.leadWorkerId));
  // หัวหน้าทีม = HT only (operator rule 2026-07-21): a worker who leads a crew
  // (htWorkerIds, from crews.lead_worker_id) and is not already leading today.
  // pickableHts intersects with the ACTIVE roster — a deactivated crew lead must
  // trigger the guidance below, not a dead picker (fresh-eyes 334fix).
  const htIds = new Set(htWorkerIds);
  const pickableHts = board.workers.filter((w) => htIds.has(w.id));
  const availableLeads = pickableHts.filter((w) => !leadIds.has(w.id));
  // A worker is offered on team T's tap list unless they are already on T, or
  // they lead ANOTHER team (their own lead may be scanned into their own team;
  // excluding all leadIds globally would wrongly block that). Leading another
  // team is a deliberate exclusion, not an oversight: a lead's team is DEFINED
  // by them, so moving their attendance elsewhere would strand a lead-less team
  // — that correction belongs on the team, not in this list.
  //
  // Spec 359 U3 — someone mustered on a DIFFERENT team today IS offered, tagged
  // with that team. Filtering them out (the pre-U3 `musteredIds` rule) left a
  // mis-checked-in worker unmovable for anyone without a badge to scan: the ย้าย
  // row control was removed in #748, so the sweep tally is the only door to
  // move_muster_worker. Tapping the row classifies as other_team — no write —
  // and offers ย้ายมาทีมนี้ in the tally.
  const addableTo = (teamId: string) => {
    const otherLeads = new Set(
      board.teams.filter((t) => t.id !== teamId).map((t) => t.leadWorkerId),
    );
    const onThisTeam = new Set(
      board.teams.find((t) => t.id === teamId)?.members.map((m) => m.workerId) ?? [],
    );
    const added = new Set(sweep.addedIds);
    return (
      board.workers
        // Someone this sweep added STAYS listed (inert, ticked) even once the
        // board catches up and calls them a member. Removing a row mid-lineup
        // reflows every chip after it under a finger already on its way down —
        // and a mis-tap here writes attendance for the WRONG person, with no
        // undo on this screen.
        .filter((w) => (!onThisTeam.has(w.id) || added.has(w.id)) && !otherLeads.has(w.id))
        .map((w) => {
          const other = added.has(w.id)
            ? undefined
            : board.teams.find(
                (x) => x.id !== teamId && x.members.some((m) => m.workerId === w.id),
              );
          return {
            ...w,
            added: added.has(w.id),
            otherTeamLead: other?.leadName ?? null,
            // move_muster_worker moves EVERY session of that day, so a worker
            // who already finished on the other team would have a completed
            // day (and its ปิดวัน labour cost) re-pointed by one tap. Say so on
            // the row rather than hiding it — the SA is the one who knows.
            otherTeamDone: other?.members.find((m) => m.workerId === w.id)?.outAt != null || false,
          };
        })
        // Free workers first: the morning lineup is the common case and must not
        // be pushed down the list by yesterday's stragglers.
        .sort((a, b) => Number(a.otherTeamLead !== null) - Number(b.otherTeamLead !== null))
    );
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
  // Spec 359 U1: this is now the NON-sweep path only (ออก / OT) — one-shot, as
  // before. The morning line goes through onSweepDetected below.
  const scanFromCamera = (teamId: string, workerId: string) =>
    session === "ot" ? scanOt(teamId, workerId, "qr") : scanRegular(teamId, workerId, "qr");

  // Spec 359 U1 — the sweep classifies from BOARD state rather than by matching
  // the RPC's Thai error text, so the outcomes survive a copy change.
  const todayTeamByWorker = new Map(
    board.teams.flatMap((t) => t.members.map((m) => [m.workerId, t.id] as const)),
  );
  const teamLeadById = new Map(board.teams.map((t) => [t.id, t.leadName] as const));
  const workersById = new Map(board.workers.map((w) => [w.id, w.name] as const));
  const priorLeadByWorker = new Map(
    board.priorTeamByWorker.map(
      (p) => [p.workerId, { id: p.leadWorkerId, name: p.leadName }] as const,
    ),
  );
  // The sweep is the morning line only: regular + เข้า. ออก and OT keep the
  // one-shot behaviour — a continuous sweep in ออก would check a whole team out
  // in seconds (spec 359 plan, scope decision).
  const sweepMode = session === "regular" && mode === "in";

  // Spec 359 U1 — one add inside an open sweep, whatever the input method. The
  // board is NOT refreshed per add (that would be a server round-trip and a
  // re-render per worker in a line); the tally is the SA's feedback and the
  // board catches up when the sheet closes.
  //
  // Spec 359 U3 — `method` is the ONLY difference between a decode and a tap.
  // Everything that makes the sweep useful (the team-change warn, the other-team
  // row, the per-person failure attribution) lives here, so the tap path gets it
  // by construction rather than by a parallel implementation that can drift.
  const sweepAdd = (teamId: string, workerId: string, method: "qr" | "manual", nowMs: number) => {
    const c = classifyScan(
      {
        teamId,
        leadWorkerId: board.teams.find((t) => t.id === teamId)?.leadWorkerId ?? "",
        workersById,
        todayTeamByWorker,
        teamLeadById,
        priorLeadByWorker,
        addedThisSweep: addedRef.current,
      },
      workerId,
    );
    setSweep((s) => recordScan(s, c, nowMs));
    playScanCue(c.kind);
    if (!c.shouldWrite) return;
    addedRef.current.add(workerId);
    const gen = sweepGenRef.current;
    startTransition(async () => {
      const res = await musterScan({
        teamId,
        workerId,
        mode: "in",
        method,
        session: "regular",
        revalidate,
      });
      if (res.ok) return;
      playScanCue("failed");
      if (gen !== sweepGenRef.current) {
        // The sweep that issued this write is over. Its tally is gone, so the
        // refusal goes to the page-level alert — a failed check-in must never
        // be swallowed just because the SA closed the sheet.
        setMessage(res.error ?? "เช็คชื่อไม่สำเร็จ");
        return;
      }
      addedRef.current.delete(workerId);
      setSweep((s) => markFailed(s, workerId, res.error));
    });
  };

  const onSweepDetected = (teamId: string, workerId: string) => {
    const now = Date.now();
    // The decode loop fires every ~180ms and the badge stays in frame while the
    // SA moves on — without this, one badge is ~5 writes a second. Read from the
    // ref (see its declaration): `sweep` is a render closure and would be stale
    // for a second decode in the same tick. A TAP needs no cooldown — it is one
    // deliberate press, and swallowing a repeat would answer the SA with silence.
    if (isCoolingDown({ ...EMPTY_SWEEP, lastSeen: lastSeenRef.current }, workerId, now)) return;
    lastSeenRef.current = { ...lastSeenRef.current, [workerId]: now };
    sweepAdd(teamId, workerId, "qr", now);
  };

  // Spec 359 U1 — resolve an other-team row from the tally, after the sweep.
  // move_muster_worker owns every guard (same date, same project, attendance
  // exists) and audits crew_change/muster_move.
  const onMoveHere = (teamId: string, workerId: string) => {
    startTransition(async () => {
      const res = await moveMusterWorker({ workerId, date, toTeamId: teamId, revalidate });
      if (res.ok) {
        // They are on this team now, but the board still says otherwise until
        // the sheet closes — mirror it into the ref so a re-tap answers
        // อยู่ในทีมแล้ว instead of offering the move a second time.
        addedRef.current.add(workerId);
        setSweep((s) => markMoved(s, workerId));
        playScanCue("added");
      } else {
        setSweep((s) => markFailed(s, workerId, res.error));
        playScanCue("failed");
      }
    });
  };

  // One refresh for the whole sweep, on close — not per scan.
  const closeSheet = () => {
    setScanTeamId(null);
    if (sweep.addedIds.length > 0) router.refresh();
    setSweep(EMPTY_SWEEP);
    lastSeenRef.current = {};
    addedRef.current = new Set();
    sweepGenRef.current += 1;
  };
  // Spec 357 U-C — the ยังไม่มา row's เช็คอิน, OUTSIDE the sheet: a one-off
  // manual check-in with no tally to render, so it keeps the plain path (and its
  // per-action refresh, which the row's own disappearance depends on). ALWAYS a
  // regular check-in — explicit mode:"in", never the toggle state.
  const onCheckInMissing = (teamId: string, workerId: string) =>
    run(() =>
      musterScan({
        teamId,
        workerId,
        mode: "in",
        method: "manual",
        session: "regular",
        revalidate,
      }),
    );

  // Spec 359 U3 — the sheet's tap list. Same pipeline as a decode, method
  // "manual". The list only renders in เข้า + regular (`showTapAdd`), which is
  // exactly `sweepMode`, so there is no non-sweep tap to fall back to.
  const onSheetTapAdd = (teamId: string, workerId: string) =>
    sweepAdd(teamId, workerId, "manual", Date.now());

  const saveWps = (teamId: string, wpIds: string[]) =>
    run(() => setMusterTeamWps({ teamId, wpIds, revalidate }));

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
    // pb clears the fixed ปิดวัน footer so the last team card is never hidden —
    // sized for the tallest state (nudge + wrapped OT warning + 2 buttons) plus
    // the safe-area inset on notched devices.
    <div className="flex flex-col gap-4 pb-44">
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

      {/* Suppressed while the add sheet is open — the sheet renders the same
          message itself, and two live role="alert" nodes announce twice. */}
      {message && !scanTeamId ? (
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
            hasCamera={hasCamera}
            onScan={scanRegular}
            onScanOt={scanOt}
            onSaveWps={saveWps}
            onCheckIn={onCheckInMissing}
            onOpenSheet={() => {
              // A leftover error from an earlier, unrelated action (open-team,
              // save-WPs…) must not greet the SA inside a fresh scan/add sheet.
              setMessage(null);
              // Spec 359 U1 — a fresh sweep per opening; the previous team's
              // tally must never carry over.
              setSweep(EMPTY_SWEEP);
              lastSeenRef.current = {};
              addedRef.current = new Set();
              sweepGenRef.current += 1;
              setScanTeamId(team.id);
            }}
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
            {/* aria-live so a screen-reader SA hears the in_progress→ready/overdue
                flip — that announcement is the whole point of the bar. */}
            <div role="status" aria-live="polite">
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
              ) : closeState.stillIn > 0 ? (
                <p className="text-ink-secondary text-sm">ยังมีช่างในงาน {closeState.stillIn} คน</p>
              ) : (
                // Teams opened but nobody scanned in yet — a "0 คน" count reads wrong.
                <p className="text-ink-secondary text-sm">ยังไม่มีช่างเช็คอิน</p>
              )}
            </div>

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

      {(() => {
        // Spec 357 U-D — the per-team scan/add sheet. A scan is one-shot (the
        // sheet closes so the SA sees the board update); tap-adds keep it open
        // for the next name in the lineup.
        const sheetTeam = scanTeamId ? board.teams.find((t) => t.id === scanTeamId) : null;
        return sheetTeam ? (
          <MusterAddSheet
            leadName={sheetTeam.leadName}
            actionLabel={
              session === "ot" ? "กำลังบันทึก OT" : mode === "in" ? "กำลังเช็คเข้า" : "กำลังเช็คออก"
            }
            sessionLabel={session === "ot" ? "OT" : "งานปกติ"}
            sweep={sweep.entries}
            hasCamera={hasCamera}
            showTapAdd={session === "regular" && mode === "in"}
            addable={addableTo(sheetTeam.id)}
            message={message}
            pending={pending}
            onScanDetected={(workerId) => {
              if (sweepMode) {
                onSweepDetected(sheetTeam.id, workerId);
                return;
              }
              scanFromCamera(sheetTeam.id, workerId);
              setScanTeamId(null);
            }}
            onTapAdd={(workerId) => onSheetTapAdd(sheetTeam.id, workerId)}
            onMoveHere={(workerId) => onMoveHere(sheetTeam.id, workerId)}
            onClose={closeSheet}
          />
        ) : null;
      })()}
    </div>
  );
}

function TeamCard({
  team,
  wps,
  mode,
  session,
  pending,
  hasCamera,
  onScan,
  onScanOt,
  onSaveWps,
  onCheckIn,
  onOpenSheet,
}: {
  team: MusterTeam;
  wps: MusterWp[];
  mode: Mode;
  session: Session;
  pending: boolean;
  hasCamera: boolean;
  /** Regular-session scan (check-out), following the เข้า/ออก mode. */
  onScan: (teamId: string, workerId: string, method: "qr" | "manual") => void;
  /** Spec 351 — OT-session scan (in/out derived per worker from their OT state). */
  onScanOt: (teamId: string, workerId: string, method: "qr" | "manual") => void;
  onSaveWps: (teamId: string, wpIds: string[]) => void;
  /** Spec 357 U-C — check a missing (expected) worker in: ALWAYS a manual
   * regular check-IN, independent of the เข้า/ออก toggle (a late arrival is
   * checked in even while the SA is doing the evening pass). */
  onCheckIn: (teamId: string, workerId: string) => void;
  /** Spec 357 U-D — opens this team's scan/add sheet (the header QR door). */
  onOpenSheet: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set(team.wpIds));
  // Spec 306 grain-coverage — which parent งาน groups are expanded in the picker.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Spec 357 U-B — true while the current picker session was seeded from the
  // prior muster day (drives the hint line; recomputed on every open).
  const [seededFromPrior, setSeededFromPrior] = useState(false);

  // Spec 357 U-B — offer only incomplete leaves, plus whatever is already
  // assigned (#742: an assigned WP stays visible even after it completes),
  // folded into collapsible groups by parent งาน (spec 306 grain-coverage).
  const wpGroups = groupMusterWps(pickerWps(wps, team.wpIds));

  const openEditor = () => {
    // Spec 357 U-B — an unassigned team seeds from the same lead's prior
    // muster day (still-incomplete WPs only). Presentation-only: nothing
    // persists until บันทึกงาน (plan = pre-fill, save = truth).
    const usePrior = team.wpIds.length === 0 && team.prefillWpIds.length > 0;
    const seed = usePrior ? team.prefillWpIds : team.wpIds;
    setSeededFromPrior(usePrior);
    setChecked(new Set(seed));
    // Open the groups that already hold a seeded child so current picks are visible.
    setExpanded(
      new Set(
        wpGroups
          .filter((g) => g.parentId !== null && g.children.some((c) => seed.includes(c.id)))
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
        <div className="flex items-center gap-2">
          {/* Spec 357 U-D — the QR door. Always present where tap-add applies
              (เข้า + regular: the sheet has the list even camera-less); in
              other modes only a camera gives the sheet content, so it gates on
              scanner support there. */}
          {(session === "regular" && mode === "in") || hasCamera ? (
            <button
              type="button"
              onClick={onOpenSheet}
              aria-label="สแกน QR / เพิ่มช่าง"
              className="bg-sunk text-ink flex min-h-11 min-w-11 items-center justify-center rounded-lg"
            >
              <QrCode aria-hidden className="size-5" />
            </button>
          ) : null}
          <span className="text-ink-muted text-meta">{team.members.length} คน</span>
        </div>
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
            {seededFromPrior ? (
              <p className="text-ink-secondary text-meta mb-2">
                เลือกงานจากมัสเตอร์วันก่อนให้แล้ว — ตรวจแล้วกดบันทึก
              </p>
            ) : null}
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
                    {/* Offered only because it is assigned (#742) — flag that it
                        is done so the SA releases it. */}
                    {wp.status === "complete" ? (
                      <span className="bg-done-soft text-done-ink text-meta rounded-full px-2 py-0.5 font-semibold">
                        เสร็จแล้ว
                      </span>
                    ) : null}
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
                <span className="text-ink flex items-center gap-1.5 text-sm">
                  {m.name}
                  {genderChip(m.gender)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-ink-muted text-meta tabular-nums">
                    {bangkokTime(m.inAt)}
                    {m.outAt ? ` – ${bangkokTime(m.outAt)}` : ""}
                    {m.outAt && m.outAuto ? " (อัตโนมัติ)" : ""}
                  </span>
                  {session === "regular" ? (
                    mode === "out" && m.inAt && !m.outAt ? (
                      <button
                        type="button"
                        onClick={() => onScan(team.id, m.workerId, "manual")}
                        disabled={pending}
                        className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                      >
                        เช็คออก
                      </button>
                    ) : null
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
            </li>
          ))}
        </ul>

        {/* Spec 357 U-C — ยังไม่มา: expected crew members (the lead's live crew
            roster, spec 330) not yet checked in anywhere today. One tap checks
            them into THIS team; the QR sheet scans them in just the same. */}
        {team.missing.length > 0 ? (
          <div className="border-edge flex flex-col gap-1.5 border-t pt-3">
            <p className="text-ink-muted text-meta font-semibold">
              ยังไม่มา ({team.missing.length})
            </p>
            <ul className="flex flex-col gap-1.5">
              {team.missing.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="text-ink-muted flex items-center gap-1.5 text-sm">
                    {m.name}
                    {genderChip(m.gender)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onCheckIn(team.id, m.id)}
                    disabled={pending}
                    className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                  >
                    เช็คอิน
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Spec 357 U-D: adding members lives in the header QR-door sheet (scan
            OR tap). The OT hint stays — OT is opened/closed per member above. */}
        {session === "ot" ? (
          <p className="text-ink-muted text-meta">
            แตะ OT เข้า / OT ออก ที่ชื่อช่างเพื่อบันทึกช่วง OT
          </p>
        ) : null}
      </div>
    </section>
  );
}
