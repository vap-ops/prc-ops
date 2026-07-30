"use client";

// Spec 357 U-D — the per-team scan/add sheet, opened from the QR door in the
// team-card header. One surface for both add paths: the camera viewfinder
// (when the device can scan — native BarcodeDetector or the jsQR fallback) and
// the manual tap-add list (เข้า + regular mode). The tap list is the
// lost-badge / phoneless / no-camera safety net the removed + เพิ่มช่าง button
// used to carry — the sheet stays open across taps so the SA can add a whole
// lineup in a row. A successful scan does NOT close the sheet either (spec 359),
// and since the decode loop learned to reschedule it does not stop scanning
// either: one camera-open per lineup, scan or tap.
//
// The action error message renders IN the sheet — the cockpit suppresses its
// page-top alert while the sheet is open (one live alert at a time).
//
// Dialog baseline per the house pattern (bottom-sheet.tsx): aria-modal,
// Escape-close, scrim-click close, focus-on-open. The tab-trap stays deferred
// exactly as bottom-sheet documents.

import { useEffect, useRef, useState } from "react";
import type { Database } from "@/lib/db/database.types";
import { undoableSession, type SweepEntry, type SweepOutcomeKind } from "@/lib/muster/sweep";
import { MusterCamera } from "./muster-camera";

// Spec 379 U2 — the retraction's words, single-sourced here (the `genderChip`
// precedent: this file is the leaf of the muster component graph, so the cockpit
// imports it without a cycle) because BOTH undo doors render them and a drift
// between the two would be invisible.
//
// ⚠️ Deliberately not เช็คออก and deliberately not a synonym of it: "they left"
// and "they were never here" are different claims about a person's day, and on
// the member row this control sits beside the check-out button.
export const MUSTER_UNDO_LABEL = "ยกเลิกเช็คชื่อ";
export const MUSTER_UNDO_CONFIRM_LABEL = "ยืนยันยกเลิก";
/** Two-tap, on both doors: this deletes an attendance record, and the cockpit's
 *  precedent for a destructive-feeling action is confirm-then-act. */
export const UNDO_BTN =
  "min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50 bg-sunk text-ink";
export const UNDO_BTN_ARMED =
  "min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50 bg-danger-soft text-danger-ink";

type WorkerGender = Database["public"]["Enums"]["worker_gender"];

// Spec 357 U-F — the ช/ญ chip rendered beside people rows (members, ยังไม่มา,
// this sheet's tap list). Null = ยังไม่ระบุ → renders nothing. Lives here (the
// leaf of the muster component graph) so the cockpit can import it without a
// cycle.
const GENDER_CHIP: Record<WorkerGender, string> = { male: "ช", female: "ญ" };
export function genderChip(gender: WorkerGender | null | undefined) {
  if (!gender) return null;
  return (
    <span className="bg-sunk text-ink-secondary text-meta rounded-full px-1.5 py-0.5 font-semibold">
      {GENDER_CHIP[gender]}
    </span>
  );
}

// Spec 359 U1 — the tally's per-outcome line. `detail` fills the placeholder
// where one is present (prior lead / other team's lead / server message).
const OUTCOME_NOTE: Record<SweepOutcomeKind, (detail: string | null) => string | null> = {
  added: () => null,
  added_first_time: () => "ครั้งแรก",
  added_team_changed: (d) => (d ? `เมื่อวานอยู่ทีม ${d}` : "เปลี่ยนทีมจากครั้งก่อน"),
  already_here: () => "อยู่ในทีมแล้ว",
  other_team: (d) => (d ? `อยู่ทีม ${d} แล้ววันนี้` : "อยู่ทีมอื่นแล้ววันนี้"),
  unknown_badge: () => "ไม่รู้จักบัตรนี้",
  failed: (d) => d ?? "เช็คชื่อไม่สำเร็จ",
  // Spec 359 U4 — the resolved rounds. `detail` is the lead of the team the scan
  // landed on: the SA never picked one, so the tally has to say which team each
  // write went to. The refusals state what the board already holds, because the
  // reason a scan wrote nothing is the only thing the SA needs to act on.
  checked_out: (d) => (d ? `เช็คออก · ทีม ${d}` : "เช็คออกแล้ว"),
  already_out: (d) => (d ? `เช็คออกแล้ว · ทีม ${d}` : "เช็คออกแล้ว"),
  not_checked_in: () => "ยังไม่ได้เช็คเข้าวันนี้",
  ot_opened: (d) => (d ? `เริ่ม OT · ทีม ${d}` : "เริ่ม OT"),
  ot_already_open: () => "OT เปิดอยู่แล้ว",
  ot_closed: (d) => (d ? `ปิด OT · ทีม ${d}` : "ปิด OT"),
  ot_already_closed: () => "ปิด OT แล้ว",
  no_ot: () => "ยังไม่ได้เปิด OT",
  // Spec 379 U2 — the row stays in the tally rather than disappearing: the SA
  // needs to see that the retraction landed, and a row vanishing under a finger
  // mid-lineup is the reflow this sheet already avoids everywhere else.
  undone: () => "ยกเลิกแล้ว",
};

// Outcomes that actually put someone on the team — these drive the ย้ายมาทีมนี้
// resolution, which only exists in the morning round (the only round where a
// worker can be on the "wrong" team, because it is the round that assigns one).
const ADDED_KINDS: ReadonlySet<SweepOutcomeKind> = new Set<SweepOutcomeKind>([
  "added",
  "added_first_time",
  "added_team_changed",
]);

// Spec 359 U4 — every outcome that WROTE. The count includes exactly these, in
// every round: a refused scan must never inflate the SA's tally.
const WRITE_KINDS: ReadonlySet<SweepOutcomeKind> = new Set<SweepOutcomeKind>([
  ...ADDED_KINDS,
  "checked_out",
  "ot_opened",
  "ot_closed",
]);

// Outcomes the SA should look at once the line is done. `already_out` /
// `ot_already_*` are deliberately NOT here: a repeat scan of someone already
// handled is the normal noise of a walk-round, not a finding. A badge with no
// session (or no OT to close) IS a finding — someone is standing there
// un-mustered.
const NEEDS_ATTENTION: ReadonlySet<SweepOutcomeKind> = new Set<SweepOutcomeKind>([
  "added_team_changed",
  "other_team",
  "unknown_badge",
  "failed",
  "not_checked_in",
  "no_ot",
]);

export function MusterAddSheet({
  leadName,
  actionLabel,
  countNoun,
  sessionLabel,
  hasCamera,
  showTapAdd,
  addable,
  message,
  pending,
  sweep,
  onScanDetected,
  onTapAdd,
  onMoveHere,
  onUndo,
  onClose,
}: {
  /** Spec 359 U4 — null for the resolved rounds: they scan the whole site, so
   *  there is no team to name and none was chosen. */
  leadName: string | null;
  /** Spec 359 U1 — the ACTION in words (กำลังเช็คเข้า / กำลังเช็คออก / กำลังบันทึก OT). */
  actionLabel: string;
  /** Spec 359 U4 — what the tally counts, in words: เพิ่มแล้ว / เช็คออกแล้ว /
   *  บันทึก OT แล้ว. The count itself is always "outcomes that wrote". */
  countNoun: string;
  /** งานปกติ | OT. */
  sessionLabel: string;
  hasCamera: boolean;
  /** เข้า + regular mode — the only mode where the tap-add list applies. */
  showTapAdd: boolean;
  /** Spec 359 U3 — `otherTeamLead` names the team this worker is ALREADY on
   *  today (null = free to add). Those rows are offered on purpose: tapping one
   *  produces an `other_team` tally row with `ย้ายมาทีมนี้`, which before this
   *  unit could only be reached by a QR decode. */
  addable: {
    id: string;
    name: string;
    gender: WorkerGender | null;
    otherTeamLead: string | null;
    /** Their session on that other team is already CLOSED — a move would
     *  re-point a finished day, so the row says so. */
    otherTeamDone: boolean;
    /** Added by this sweep. Stays listed, inert, so the rows below it do not
     *  shift under a finger mid-lineup. */
    added: boolean;
  }[];
  message: string | null;
  pending: boolean;
  /** Spec 359 U1 — this sweep's outcomes, newest first. Empty outside a sweep. */
  sweep: SweepEntry[];
  onScanDetected: (workerId: string) => void;
  onTapAdd: (workerId: string) => void;
  /** Spec 359 U1 — resolve an `other_team` tally row by moving them onto this team. */
  onMoveHere: (workerId: string) => void;
  /** Spec 379 U2 — retract the write this tally row recorded. Identified by
   *  `seq`, never by worker: one worker can hold several rows in a sweep and the
   *  SA is pointing at ONE of them. The cockpit derives the muster session from
   *  that row's outcome. */
  onUndo: (seq: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Spec 379 U2 — which tally row's undo is armed. One at a time: arming a
  // second row disarms the first, so a stray tap can never leave two live
  // one-tap deletes on screen.
  const [armedUndo, setArmedUndo] = useState<number | null>(null);

  // Spec 359 U3 — workers this sweep has settled onto THIS team (an add, or an
  // other_team row resolved by a move — markMoved rewrites it to `added`). Their
  // remaining other_team rows must not keep offering the move.
  const resolvedIds = new Set(
    sweep.filter((e) => ADDED_KINDS.has(e.outcome)).map((e) => e.workerId),
  );

  // Spec 359 U2 — one definition, rendered by both arms below (disclosed behind
  // a summary when a camera exists, plain when it does not) so the two paths can
  // never drift apart.
  const tapAddList = (
    <div data-testid="tap-add-list" className="flex flex-col gap-2">
      <p className="text-ink-secondary text-meta font-semibold">แตะชื่อเพื่อเพิ่มเข้าทีม</p>
      {/* Spec 359 U3 — the tagged rows do NOT add, so say what they do. Only
          rendered when at least one is present. */}
      {addable.some((w) => w.otherTeamLead) ? (
        <p className="text-ink-secondary text-meta">
          คนที่อยู่ทีมอื่นวันนี้ — แตะเพื่อขอย้ายมาทีมนี้
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {addable.length ? (
          addable.map((w) => (
            // Spec 359 U3 — NOT disabled while a write is in flight. The whole
            // point of the tap path is a lineup tapped in a row; a per-write
            // freeze is the cost this spec exists to remove. A double-tap is
            // harmless — the cockpit's addedThisSweep ref classifies the repeat
            // as อยู่ในทีมแล้ว and writes nothing. An ADDED row stays mounted
            // and inert instead of disappearing, so nothing reflows under a
            // finger already moving toward the next name.
            <button
              key={w.id}
              type="button"
              onClick={() => onTapAdd(w.id)}
              disabled={w.added}
              className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm ${
                w.added ? "bg-sunk text-ink-muted opacity-60" : "bg-sunk text-ink"
              }`}
            >
              {w.added ? "✓ " : null}
              {w.name}
              {genderChip(w.gender)}
              {w.otherTeamLead ? (
                <span className="bg-attn-soft text-attn-ink text-meta rounded-full px-1.5 py-0.5 font-semibold">
                  อยู่ทีม {w.otherTeamLead}
                  {w.otherTeamDone ? " · ออกแล้ว" : null}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <span className="text-ink-muted text-meta">ช่างทุกคนเข้าทีมแล้ว</span>
        )}
      </div>
    </div>
  );

  // Focus the panel on mount only (the cockpit passes inline handlers with a
  // new identity each render — an every-render focus would yank it around).
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      // Spec 359 U4 — a screen-reader SA in an evening round would otherwise be
      // told "ทีม null": these rounds have no team by design.
      aria-label={leadName === null ? "สแกน — ทุกทีม" : `สแกน/เพิ่มช่าง — ทีม ${leadName}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black/90 p-4"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto my-auto flex w-full max-w-md flex-col gap-4 focus:outline-none"
      >
        {/* Spec 359 U1 — the action header. States the VERB, not a toggle state:
            the cockpit's เข้า/ออก and งานปกติ/OT toggles decide what a decode
            does, and under a continuous sweep a wrong mode would check a whole
            team out in seconds without the SA noticing. Sticky so it survives
            scrolling a long tally. */}
        <div
          data-testid="sweep-action-header"
          className="bg-card rounded-card sticky top-0 z-10 px-3 py-2"
        >
          <p className="text-ink text-sm font-bold">
            {/* Spec 359 U4 — a resolved round scans the whole site, so it says so
                rather than naming a team the SA never picked. */}
            {actionLabel} · {leadName === null ? "ทุกทีม" : `ทีม ${leadName}`} · {sessionLabel}
          </p>
        </div>

        {/* `continuous` — the sheet exists to sweep a whole lineup in ONE
            camera-open. Without it the loop stopped on the first badge and the
            SA had to close and reopen the sheet per worker, which is what she
            reported as "the scanner turns off after adding". */}
        {hasCamera ? <MusterCamera onDetected={onScanDetected} continuous /> : null}

        {sweep.length > 0 ? (
          <div className="bg-card rounded-card flex flex-col gap-2 p-3" data-testid="sweep-tally">
            <p data-testid="sweep-count" className="text-ink text-sm font-bold">
              {countNoun} {sweep.filter((e) => WRITE_KINDS.has(e.outcome)).length} คน
            </p>
            {/* aria-live so a screen-reader SA hears each outcome without looking. */}
            <ul role="status" aria-live="polite" className="flex flex-col gap-1.5">
              {sweep.map((e) => {
                const note = OUTCOME_NOTE[e.outcome](e.detail);
                return (
                  <li key={e.seq} className="flex flex-wrap items-center gap-2">
                    <span data-testid="sweep-entry-name" className="text-ink text-sm font-semibold">
                      {e.outcome === "unknown_badge" ? "—" : e.name}
                    </span>
                    {note ? (
                      <span
                        // Spec 359 U3 — a refused WRITE is not the same class of
                        // event as a team-change note. Before this unit a failed
                        // tap rendered as a danger alert; sharing the amber chip
                        // with an advisory would have quietly demoted it.
                        className={`text-meta rounded-full px-2 py-0.5 font-semibold ${
                          e.outcome === "failed"
                            ? "bg-danger-soft text-danger-ink"
                            : NEEDS_ATTENTION.has(e.outcome)
                              ? "bg-attn-soft text-attn-ink"
                              : "bg-sunk text-ink-secondary"
                        }`}
                      >
                        {note}
                      </span>
                    ) : null}
                    {/* Spec 359 U1 — offered in the ROW, not as a modal: the SA
                        keeps sweeping the line and settles the amber rows when
                        the line is done. Spec 359 U3: only while the worker is
                        still UNRESOLVED — tapping a tagged name twice makes two
                        other_team rows, and markMoved converts only the newest,
                        so the older row would keep a live button that re-fires
                        the move. */}
                    {e.outcome === "other_team" && !resolvedIds.has(e.workerId) ? (
                      <button
                        type="button"
                        onClick={() => onMoveHere(e.workerId)}
                        disabled={pending}
                        className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                      >
                        ย้ายมาทีมนี้
                      </button>
                    ) : null}
                    {/* Spec 379 U2, door 1 — the common case: wrong person,
                        three seconds ago, sheet still open. Offered on the rows
                        whose write CREATED an attendance row (undoableSession);
                        a check-out write is not one of them, because the RPC
                        deletes the row rather than clearing `out_at`. */}
                    {undoableSession(e.outcome) !== null ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (armedUndo === e.seq) {
                            setArmedUndo(null);
                            onUndo(e.seq);
                          } else {
                            setArmedUndo(e.seq);
                          }
                        }}
                        disabled={pending}
                        className={armedUndo === e.seq ? UNDO_BTN_ARMED : UNDO_BTN}
                      >
                        {armedUndo === e.seq ? MUSTER_UNDO_CONFIRM_LABEL : MUSTER_UNDO_LABEL}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {message ? (
          <p role="alert" className="bg-danger-soft text-danger-ink rounded-card px-3 py-2 text-sm">
            {message}
          </p>
        ) : null}

        {showTapAdd ? (
          hasCamera ? (
            // Spec 359 U2 — camera-first. The SA sees the viewfinder, not a wall
            // of names. The list is NOT removed: it is the lost-badge /
            // phoneless / unreadable-badge path (spec 357 U-D's signal-removal
            // rule), so it stays one tap away with its stays-open behaviour
            // intact. <details> keeps this zero-JS and needs no state.
            <details className="bg-card rounded-card p-3">
              <summary className="text-ink-secondary text-meta flex min-h-11 items-center font-semibold">
                ไม่มีบัตร / หาไม่เจอ
              </summary>
              <div className="pt-2">{tapAddList}</div>
            </details>
          ) : (
            <div className="bg-card rounded-card p-3">{tapAddList}</div>
          )
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="bg-card text-ink min-h-11 w-full rounded-lg px-4 text-sm font-bold"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}
