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
  closeOpenOt,
  undoMusterScan,
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
  markUndone,
  recordScan,
  undoableSession,
  type SweepAction,
  type SweepState,
} from "@/lib/muster/sweep";
import { playScanCue } from "@/lib/muster/scan-cue";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import type { MusterWp } from "@/lib/muster/wp-groups";
import type { MusterBoard, MusterTeam } from "@/lib/muster/load-muster";
import { MusterAddSheet, genderChip, UndoControl } from "./muster-add-sheet";

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
  // Spec 351 — งานปกติ (regular) vs OT session. Field bug 2026-07-26: OT scans
  // used to DERIVE in/out per worker, which turned a second input for the same
  // worker into a check-OUT; both sessions now take their direction from the
  // เข้า/ออก toggle below.
  const [session, setSession] = useState<Session>("regular");
  const [leadPick, setLeadPick] = useState("");
  const [scanTeamId, setScanTeamId] = useState<string | null>(null);
  /** Spec 359 U4 — the page-level, team-agnostic scanner is open (evening rounds). */
  const [siteScan, setSiteScan] = useState(false);
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

  // Spec 351 — a regular scan follows the เข้า/ออก mode.
  const scanRegular = (teamId: string, workerId: string, method: "qr" | "manual") =>
    run(() => musterScan({ teamId, workerId, mode, method, session: "regular", revalidate }));
  // Field bug 2026-07-26 — an OT scan takes its direction from the CALLER, never
  // from the worker's OT state. Deriving it made a second input for the same
  // worker mean the opposite of the first: prod row 70cc66a3 was manually opened
  // (OT เข้า 17:25:47) and then, when his badge was scanned ten seconds later,
  // silently CLOSED — ot_hours NULL and nothing in the app reopens a closed OT.
  // A direction that contradicts the worker's state now refuses, so a duplicate
  // scan costs the SA a message instead of the man's OT.
  const scanOt = (teamId: string, workerId: string, method: "qr" | "manual", direction: Mode) => {
    const member = board.teams
      .find((t) => t.id === teamId)
      ?.members.find((m) => m.workerId === workerId);
    const ot = member?.ot ?? null;
    // Closed OT: unique(worker_id, work_date, session) means there is no second
    // OT session to open and nothing left to close, in either direction.
    if (ot?.outAt) {
      setMessage("ช่างคนนี้ปิด OT แล้ว");
      return;
    }
    if (direction === "in" && ot) {
      setMessage("ช่างคนนี้เปิด OT อยู่แล้ว");
      return;
    }
    if (direction === "out" && !ot) {
      setMessage("ยังไม่ได้เปิด OT ของช่างคนนี้");
      return;
    }
    run(() => musterScan({ teamId, workerId, mode: direction, method, session: "ot", revalidate }));
  };
  // Spec 359 U4 — there is no one-shot camera path left: every round sweeps, so
  // a decode always goes through `onSweepDetected` → `classifyScan`. `scanRegular`
  // and `scanOt` above are now the MANUAL board buttons only (เช็คออก, OT เข้า,
  // OT ออก), where the label states the direction.
  //
  // Each session's round starts with check-ins, and เข้า is the direction that
  // cannot destroy a record — so switching session never inherits ออก from the
  // round the SA just finished.
  const switchSession = (next: Session) => {
    setSession(next);
    setMode("in");
  };

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
  // Spec 359 U4 — a worker's session today, across EVERY team. Only the morning
  // line creates membership; the other three rounds READ it, so they resolve the
  // team from here rather than from a team the SA had to pick.
  const sessionByWorker = new Map(
    board.teams.flatMap((t) =>
      t.members.map((m) => [m.workerId, { teamId: t.id, outAt: m.outAt, ot: m.ot }] as const),
    ),
  );
  // Spec 359 U4 — every round sweeps now (operator: "all checking should [be QR]").
  // U1 held ออก back because a continuous sweep could check a team out silently;
  // the direction is stated on screen since the 2026-07-26 fix, and `classifyScan`
  // refuses the writes that would DESTROY a value (already_out / ot_already_*)
  // rather than repeat them.
  const action: SweepAction = { session, direction: mode };
  // The morning line is the only round that CHOOSES a team, so it is the only one
  // whose door lives on a team card. The rest open one page-level scanner.
  const teamScoped = session === "regular" && mode === "in";
  // What the tally counts, in this round's words.
  const countNoun = teamScoped
    ? "เพิ่มแล้ว"
    : session === "ot"
      ? mode === "in"
        ? "เริ่ม OT แล้ว"
        : "ปิด OT แล้ว"
      : "เช็คออกแล้ว";
  // The page-level door's label states the round, so the SA reads what the camera
  // will write before opening it (the 2026-07-26 direction lesson).
  const siteScanLabel =
    session === "ot" ? (mode === "in" ? "สแกน OT เข้า" : "สแกน OT ออก") : "สแกนเช็คออก";

  // Spec 359 U1 — one add inside an open sweep, whatever the input method. The
  // board is NOT refreshed per add (that would be a server round-trip and a
  // re-render per worker in a line); the tally is the SA's feedback and the
  // board catches up when the sheet closes.
  //
  // Spec 359 U3 — `method` is the ONLY difference between a decode and a tap.
  // Everything that makes the sweep useful (the team-change warn, the other-team
  // row, the per-person failure attribution) lives here, so the tap path gets it
  // by construction rather than by a parallel implementation that can drift.
  //
  // Spec 359 U4 — `teamId` is the team whose sheet is open, or NULL for a
  // resolved round. The write always goes to `c.teamId`, which the classifier
  // filled in: the chosen team in the morning, the worker's own team otherwise.
  const sweepAdd = (
    teamId: string | null,
    workerId: string,
    method: "qr" | "manual",
    nowMs: number,
  ) => {
    const c = classifyScan(
      {
        teamId,
        leadWorkerId:
          (teamId === null ? null : board.teams.find((t) => t.id === teamId)?.leadWorkerId) ?? "",
        workersById,
        todayTeamByWorker,
        teamLeadById,
        priorLeadByWorker,
        addedThisSweep: addedRef.current,
        sessionByWorker,
      },
      workerId,
      action,
    );
    setSweep((s) => recordScan(s, c, nowMs));
    playScanCue(c.kind);
    if (!c.shouldWrite || c.teamId === null) return;
    addedRef.current.add(workerId);
    const gen = sweepGenRef.current;
    const writeTeamId = c.teamId;
    startTransition(async () => {
      const res = await musterScan({
        teamId: writeTeamId,
        workerId,
        mode: action.direction,
        method,
        session: action.session,
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

  const onSweepDetected = (teamId: string | null, workerId: string) => {
    const now = Date.now();
    // The decode loop fires every ~180ms and the badge stays in frame while the
    // SA moves on — without this, one badge is ~5 writes a second. Read from the
    // ref (see its declaration): `sweep` is a render closure and would be stale
    // for a second decode in the same tick. A TAP needs no cooldown — it is one
    // deliberate press, and swallowing a repeat would answer the SA with silence.
    // Re-arm on the suppressed decode, don't just drop it: a badge PARKED in the
    // viewfinder keeps decoding now that the loop reschedules, so a window that
    // only counted from the last ACCEPTED scan would let the same worker record
    // a fresh row and play a fresh cue every 3s until the sheet closed. Counting
    // from the last decode instead means the badge has to leave the frame for a
    // full window before it can speak again — which is exactly what a deliberate
    // re-scan looks like, and what a parked badge never does.
    const cooling = isCoolingDown({ ...EMPTY_SWEEP, lastSeen: lastSeenRef.current }, workerId, now);
    lastSeenRef.current = { ...lastSeenRef.current, [workerId]: now };
    if (cooling) return;
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

  // Spec 379 U2, door 1 — retract a write this sweep made. The session is
  // DERIVED from the row's own outcome (undoableSession), never read off the
  // live session toggle: the toggles sit on the page behind the sheet, and
  // keying a delete on a control the SA cannot see while she taps is exactly the
  // 2026-07-26 direction defect in a more expensive form.
  const undoSweepEntry = (seq: number) => {
    const entry = sweep.entries.find((e) => e.seq === seq);
    if (!entry) return;
    const undoSession = undoableSession(entry.outcome);
    if (undoSession === null) return;
    const gen = sweepGenRef.current;
    startTransition(async () => {
      const res = await undoMusterScan({
        workerId: entry.workerId,
        date,
        session: undoSession,
        revalidate,
      });
      if (!res.ok) {
        playScanCue("failed");
        // Covers BOTH sweeps: while the sheet is open the sheet renders
        // `message`, and once it has closed the page-level alert does. The one
        // thing that must never happen is a refusal with nowhere to land.
        setMessage(res.error);
        return;
      }
      playScanCue("undone");
      setMessage(null);
      if (gen !== sweepGenRef.current) {
        // The sweep that issued this retraction is over. Its tally is gone, and
        // the closing router.refresh() already counted a worker the DB no
        // longer holds — so the board needs a second look.
        router.refresh();
        return;
      }
      addedRef.current.delete(entry.workerId);
      setSweep((s) => markUndone(s, seq));
    });
  };

  // Spec 379 U2, door 2 — the same repair from the team card, found later. Goes
  // through `run` so a refusal reaches the page alert and a success refreshes
  // the board the row is rendered from.
  const undoMember = (workerId: string, undoSession: Session) =>
    run(() => undoMusterScan({ workerId, date, session: undoSession, revalidate }));

  // One refresh for the whole sweep, on close — not per scan.
  const closeSheet = () => {
    setScanTeamId(null);
    setSiteScan(false);
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
  // Spec 359 U4b — the evening scanner's home is the ปิดวัน bar; it steps aside for
  // the close confirmation (a focused decision must not carry a second primary).
  const eveningScan = !teamScoped && hasCamera && board.teams.length > 0 && !confirmClose;
  const closeState = deriveCloseDayState({
    teams: board.teams,
    closure: board.closure,
    pastDayEnd,
  });
  // Spec 359 U4b — which of the bar's two actions is the next one. While anyone is
  // still shown in, or any OT is still open, the sweep comes first and ปิดวัน waits;
  // once neither is true the day is genuinely done and ปิดวัน takes primary back.
  // Gated on the scanner actually rendering, so a camera-less device never loses the
  // ready/overdue highlight on ปิดวัน — its only nudge.
  const sweepFirst = eveningScan && (closeState.openOt > 0 || closeState.stillIn > 0);

  // Spec 306 close-day cure — what ปิดวัน is about to DO, per case, from the board.
  // The two cases are NOT the same and the confirm must not pretend they are: an
  // open OT is lost for good, a missing regular check-out is auto-outed at 17:00
  // and flagged (`out_auto`), so nothing is lost there — it just has to be said.
  const openOtSessions = board.teams.flatMap((t) =>
    t.members
      .filter((m) => m.ot && m.ot.inAt && !m.ot.outAt)
      .map((m) => ({ teamId: t.id, workerId: m.workerId, name: m.name })),
  );
  const stillInNames = board.teams.flatMap((t) =>
    t.members.filter((m) => m.inAt && !m.outAt).map((m) => m.name),
  );
  // Names, not just a count: "3 คน" is a number to tap past, a name is a person to
  // go and find. Capped so a 20-strong team cannot push the buttons off screen.
  const nameList = (names: string[]) =>
    names.length <= 5 ? names.join(" · ") : `${names.slice(0, 5).join(" · ")} +${names.length - 5}`;

  // Close every open OT at the current time, THEN close the day — and only then.
  // A failed cure must leave the day open: closing anyway would destroy exactly
  // the OT this button exists to save, which is worse than not closing.
  const cureThenClose = () => {
    run(async () => {
      const cure = await closeOpenOt({
        sessions: openOtSessions.map((s) => ({ teamId: s.teamId, workerId: s.workerId })),
        revalidate,
      });
      if (!cure.ok) {
        // A PARTIAL cure is the dangerous state: some OT sessions did close, and
        // the board does not know yet. `run` only refreshes on success, so without
        // this the confirm would still list them — and a second tap would re-run
        // `muster_scan_out` over rows that are already out, overwriting their real
        // out time with now() (the RPC has no already-out guard). Refresh first,
        // then report: the retry must see a truthful list.
        router.refresh();
        return cure;
      }
      setConfirmClose(false);
      return closeMusterDay({ projectId, date, revalidate });
    });
  };

  return (
    // pb clears the fixed ปิดวัน footer so the last team card is never hidden —
    // sized for the tallest state (nudge + wrapped OT warning + 2 buttons) plus
    // the safe-area inset on notched devices.
    // Spec 359 U4b — the bottom padding clears the fixed ปิดวัน bar, now sized for
    // its tallest state: status line + OT warning + the evening scanner + ปิดวัน,
    // plus the safe-area inset.
    <div className="flex flex-col gap-4 pb-56">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink font-semibold">{formatThaiDate(date)}</p>
        {/* Spec 359 U4b — the round toggles keep this row to THEMSELVES. The
            evening scanner sat here inline and wrapped the row on a phone,
            pushing the toggles left; it lives in the ปิดวัน bar now. */}
        <div data-testid="muster-round-toggles" className="flex items-center gap-2">
          {/* Spec 351 — session toggle: normal hours vs OT. */}
          <div className="flex overflow-hidden rounded-full">
            <button
              type="button"
              onClick={() => switchSession("regular")}
              className={`min-h-11 px-4 text-sm font-bold ${session === "regular" ? TOGGLE_ON : TOGGLE_OFF}`}
            >
              งานปกติ
            </button>
            <button
              type="button"
              onClick={() => switchSession("ot")}
              className={`min-h-11 px-4 text-sm font-bold ${session === "ot" ? TOGGLE_ON : TOGGLE_OFF}`}
            >
              OT
            </button>
          </div>
          {/* Field bug 2026-07-26 — เข้า/ออก now governs BOTH sessions. The camera
              writes the direction shown here and nothing else, so a badge scanned
              twice repeats the same intent instead of reversing it. */}
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
            onScan={scanRegular}
            onScanOt={scanOt}
            onSaveWps={saveWps}
            onCheckIn={onCheckInMissing}
            onUndo={undoMember}
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
        <div
          data-testid="muster-day-bar"
          className="border-edge bg-card shadow-up fixed inset-x-0 bottom-0 z-40 border-t px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-2`}>
            {/* aria-live so a screen-reader SA hears the in_progress→ready/overdue
                flip — that announcement is the whole point of the bar. */}
            <div role="status" aria-live="polite">
              {closeState.kind === "ready" ? (
                // Field bug 2026-07-26 — `stillIn` counts the REGULAR session, so
                // "ทุกคนเช็คออกแล้ว" read as done while OT was still running (the
                // SA's 17:27 screenshot: 4 open OT sessions under that line).
                // close_muster_day auto-outs regular only, so closing here loses
                // their OT for good; name the regular session and let the warning
                // below carry the rest.
                <p className="text-ink text-sm font-semibold">
                  {closeState.openOt > 0
                    ? "ทุกคนเช็คออกงานปกติแล้ว · ปิดวันเพื่อบันทึกค่าแรง"
                    : "ทุกคนเช็คออกแล้ว · ปิดวันเพื่อบันทึกค่าแรง"}
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

            {/* Field bug 2026-07-26 — this warning used to appear only AFTER the SA
                pressed ปิดวัน, i.e. one tap from the loss it warns about. An open
                OT is a fact about the day, so it is stated while there is still
                time to close it (07-24: 9 OT rows left open, all ot_hours NULL). */}
            {closeState.openOt > 0 && closeState.kind !== "closed" ? (
              <p className="text-attn-ink text-meta">
                มีช่าง {closeState.openOt} คนยัง OT ไม่ปิด — ปิดวันจะไม่บันทึก OT ของพวกเขา
              </p>
            ) : null}

            {/* Spec 359 U4b — the evening scanner, in the bar rather than inline in
                the header row (which it wrapped on a phone). This bar is already the
                "what next" surface, it is the best one-handed thumb reach, and it
                stays put while the SA scrolls team cards on a walk-round. It also
                makes the sequencing visible: sweep them out, THEN close the day. */}
            {eveningScan ? (
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setSweep(EMPTY_SWEEP);
                  lastSeenRef.current = {};
                  addedRef.current = new Set();
                  sweepGenRef.current += 1;
                  setSiteScan(true);
                }}
                className={`flex w-full items-center justify-center gap-1.5 ${sweepFirst ? BAR_PRIMARY : BAR_SUNK}`}
              >
                <QrCode aria-hidden className="size-4" />
                {siteScanLabel}
              </button>
            ) : null}

            {confirmClose ? (
              <>
                {/* Spec 306 close-day cure — the auto-out is honest, but silent
                    until now: closing writes a 17:00 out time for anyone still in
                    and flags it `out_auto`. Say it, and name them, so the SA can
                    go and fix a real one instead of accepting a guess. */}
                {stillInNames.length > 0 ? (
                  <p data-testid="close-day-autoout" className="text-ink-secondary text-meta">
                    ช่าง {stillInNames.length} คนยังไม่เช็คออก — ระบบจะบันทึกเวลาออก 17:00 ให้ ·{" "}
                    {nameList(stillInNames)}
                  </p>
                ) : null}
                {openOtSessions.length > 0 ? (
                  // The cure comes FIRST and carries the primary weight. Closing
                  // without it stays reachable — the SA may have a worker who left
                  // un-scanned — but it is a deliberate second choice, never the
                  // default, and it names the cost in people.
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={cureThenClose}
                      disabled={pending}
                      className={`w-full ${BAR_PRIMARY}`}
                    >
                      ปิด OT ให้ทุกคนตอนนี้ ({openOtSessions.length}) แล้วปิดวัน
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={closeDay}
                        disabled={pending}
                        className={`bg-danger-soft text-danger-ink flex-1 ${BAR_BTN}`}
                      >
                        ปิดวันโดยไม่บันทึก OT ของ {openOtSessions.length} คน
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClose(false)}
                        className={BAR_SUNK}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={closeDay}
                      disabled={pending}
                      className={`flex-1 ${BAR_PRIMARY}`}
                    >
                      ยืนยันปิดวัน
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClose(false)}
                      className={BAR_SUNK}
                    >
                      ยกเลิก
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClose(true)}
                disabled={pending}
                className={`w-full ${(closeState.kind === "ready" || closeState.kind === "overdue") && !sweepFirst ? BAR_PRIMARY : BAR_SUNK}`}
              >
                {closeState.kind === "closed" ? "ปิดวันอีกครั้ง" : "ปิดวัน"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {(() => {
        // Spec 357 U-D — the per-team scan/add sheet, now the MORNING sheet only.
        // Spec 359 U4 — the evening rounds open the same sheet with no team
        // (`siteScan`): they resolve each badge's own team, so there is nothing to
        // pick and nothing to name.
        const sheetTeam = scanTeamId ? board.teams.find((t) => t.id === scanTeamId) : null;
        if (!sheetTeam && !siteScan) return null;
        return (
          <MusterAddSheet
            leadName={sheetTeam?.leadName ?? null}
            actionLabel={
              session === "ot"
                ? mode === "in"
                  ? "กำลังบันทึก OT เข้า"
                  : "กำลังบันทึก OT ออก"
                : mode === "in"
                  ? "กำลังเช็คเข้า"
                  : "กำลังเช็คออก"
            }
            countNoun={countNoun}
            sessionLabel={session === "ot" ? "OT" : "งานปกติ"}
            sweep={sweep.entries}
            hasCamera={hasCamera}
            showTapAdd={teamScoped && sheetTeam !== null}
            addable={sheetTeam ? addableTo(sheetTeam.id) : []}
            message={message}
            pending={pending}
            onScanDetected={(workerId) => onSweepDetected(sheetTeam?.id ?? null, workerId)}
            onTapAdd={(workerId) => (sheetTeam ? onSheetTapAdd(sheetTeam.id, workerId) : undefined)}
            onMoveHere={(workerId) => (sheetTeam ? onMoveHere(sheetTeam.id, workerId) : undefined)}
            onUndo={undoSweepEntry}
            onClose={closeSheet}
          />
        );
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
  onScan,
  onScanOt,
  onSaveWps,
  onCheckIn,
  onUndo,
  onOpenSheet,
}: {
  team: MusterTeam;
  wps: MusterWp[];
  mode: Mode;
  session: Session;
  pending: boolean;
  /** Regular-session scan (check-out), following the เข้า/ออก mode. */
  onScan: (teamId: string, workerId: string, method: "qr" | "manual") => void;
  /** Spec 351 — OT-session scan. The DIRECTION is the caller's (field bug
   * 2026-07-26): each per-member button states which way it writes. */
  onScanOt: (teamId: string, workerId: string, method: "qr" | "manual", direction: Mode) => void;
  onSaveWps: (teamId: string, wpIds: string[]) => void;
  /** Spec 357 U-C — check a missing (expected) worker in: ALWAYS a manual
   * regular check-IN, independent of the เข้า/ออก toggle (a late arrival is
   * checked in even while the SA is doing the evening pass). */
  onCheckIn: (teamId: string, workerId: string) => void;
  /** Spec 379 U2 — retract this worker's check-in for one session. Not a
   * check-out: it says the muster never happened, and the RPC deletes the row
   * (after writing it whole into audit_log). */
  onUndo: (workerId: string, session: Session) => void;
  /** Spec 357 U-D — opens this team's scan/add sheet (the header QR door). */
  onOpenSheet: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  // Spec 379 U2 — the armed row, keyed `<workerId>:<session>`: the regular and
  // OT retractions are two different deletes on one member, and arming one must
  // never leave the other a single tap away. One armed control at a time.
  const [armedUndo, setArmedUndo] = useState<string | null>(null);
  const undoButton = (workerId: string, undoSession: Session) => {
    const key = `${workerId}:${undoSession}`;
    return (
      <UndoControl
        armed={armedUndo === key}
        pending={pending}
        onArm={() => setArmedUndo(key)}
        onDisarm={() => setArmedUndo(null)}
        onConfirm={() => {
          setArmedUndo(null);
          onUndo(workerId, undoSession);
        }}
      />
    );
  };
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
          {/* Spec 357 U-D — the QR door, for the MORNING round: the sheet carries
              the tap-add list here even camera-less, and this is the round where
              picking a team is the point.
              Spec 359 U4 — the evening rounds no longer open per team; their door
              is the page-level scanner beside the toggles, so this one is hidden
              rather than opening a sheet whose team choice is now meaningless. */}
          {session === "regular" && mode === "in" ? (
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
            <li
              key={m.workerId}
              data-testid={`member-${m.workerId}`}
              className="flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink flex items-center gap-1.5 text-sm">
                  {m.name}
                  {genderChip(m.gender)}
                </span>
                {/* Spec 379 U2 — wraps: the retraction is a third control on a
                    row that already carries a time and a round button, and a
                    phone-width row must never push one of them off screen. */}
                <div className="flex flex-wrap items-center justify-end gap-2">
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
                    // The label IS the direction, so it passes "in" explicitly and
                    // stays right whichever way the เข้า/ออก toggle is set.
                    <button
                      type="button"
                      onClick={() => onScanOt(team.id, m.workerId, "manual", "in")}
                      disabled={pending}
                      className="bg-fill text-on-fill min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                    >
                      OT เข้า
                    </button>
                  ) : !m.ot.outAt ? (
                    // OT open → close it (OT ออก).
                    <button
                      type="button"
                      onClick={() => onScanOt(team.id, m.workerId, "manual", "out")}
                      disabled={pending}
                      className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                    >
                      OT ออก
                    </button>
                  ) : null}
                  {/* Spec 379 U2, door 2 — session-gated exactly like the round
                      buttons beside it: the งานปกติ round retracts the regular
                      row, the OT round retracts the OT row (below). Without the
                      OT half, D4's refusal — "undo the OT session first" —
                      would name an action that does not exist. */}
                  {session === "regular" && m.inAt ? undoButton(m.workerId, "regular") : null}
                </div>
              </div>
              {/* Spec 351 — the worker's OT session: its window + an open-OT flag
                  (surfaced whenever there is an OT row, in either session view). */}
              {m.ot ? (
                <div
                  data-testid={`member-ot-${m.workerId}`}
                  className="flex flex-wrap items-center gap-2"
                >
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
                  {session === "ot" ? undoButton(m.workerId, "ot") : null}
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
