"use client";

// Spec 357 U-D — the per-team scan/add sheet, opened from the QR door in the
// team-card header. One surface for both add paths: the camera viewfinder
// (when the device can scan — native BarcodeDetector or the jsQR fallback) and
// the manual tap-add list (เข้า + regular mode). The tap list is the
// lost-badge / phoneless / no-camera safety net the removed + เพิ่มช่าง button
// used to carry — the sheet stays open across taps so the SA can add a whole
// lineup in a row. A successful SCAN closes the sheet (one-shot, matching the
// pre-357 camera behavior; continuous multi-scan is deferred until the #745
// decode loop has on-device proof).
//
// The action error message renders IN the sheet — the cockpit suppresses its
// page-top alert while the sheet is open (one live alert at a time).
//
// Dialog baseline per the house pattern (bottom-sheet.tsx): aria-modal,
// Escape-close, scrim-click close, focus-on-open. The tab-trap stays deferred
// exactly as bottom-sheet documents.

import { useEffect, useRef } from "react";
import type { Database } from "@/lib/db/database.types";
import type { SweepEntry, SweepOutcomeKind } from "@/lib/muster/sweep";
import { MusterCamera } from "./muster-camera";

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
};

// Outcomes that actually put someone on the team — the only ones the count
// includes. A refused scan must never inflate "เพิ่มแล้ว N คน".
const ADDED_KINDS: ReadonlySet<SweepOutcomeKind> = new Set<SweepOutcomeKind>([
  "added",
  "added_first_time",
  "added_team_changed",
]);

// Outcomes the SA should look at once the line is done.
const NEEDS_ATTENTION: ReadonlySet<SweepOutcomeKind> = new Set<SweepOutcomeKind>([
  "added_team_changed",
  "other_team",
  "unknown_badge",
  "failed",
]);

export function MusterAddSheet({
  leadName,
  actionLabel,
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
  onClose,
}: {
  leadName: string;
  /** Spec 359 U1 — the ACTION in words (กำลังเช็คเข้า / กำลังเช็คออก / กำลังบันทึก OT). */
  actionLabel: string;
  /** งานปกติ | OT. */
  sessionLabel: string;
  hasCamera: boolean;
  /** เข้า + regular mode — the only mode where the tap-add list applies. */
  showTapAdd: boolean;
  addable: { id: string; name: string; gender: WorkerGender | null }[];
  message: string | null;
  pending: boolean;
  /** Spec 359 U1 — this sweep's outcomes, newest first. Empty outside a sweep. */
  sweep: SweepEntry[];
  onScanDetected: (workerId: string) => void;
  onTapAdd: (workerId: string) => void;
  /** Spec 359 U1 — resolve an `other_team` tally row by moving them onto this team. */
  onMoveHere: (workerId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Spec 359 U2 — one definition, rendered by both arms below (disclosed behind
  // a summary when a camera exists, plain when it does not) so the two paths can
  // never drift apart.
  const tapAddList = (
    <div className="flex flex-col gap-2">
      <p className="text-ink-secondary text-meta font-semibold">แตะชื่อเพื่อเพิ่มเข้าทีม</p>
      <div className="flex flex-wrap gap-2">
        {addable.length ? (
          addable.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onTapAdd(w.id)}
              disabled={pending}
              className="bg-sunk text-ink flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm disabled:opacity-50"
            >
              {w.name}
              {genderChip(w.gender)}
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
      aria-label={`สแกน/เพิ่มช่าง — ทีม ${leadName}`}
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
            {actionLabel} · ทีม {leadName} · {sessionLabel}
          </p>
        </div>

        {hasCamera ? <MusterCamera onDetected={onScanDetected} /> : null}

        {sweep.length > 0 ? (
          <div className="bg-card rounded-card flex flex-col gap-2 p-3">
            <p data-testid="sweep-count" className="text-ink text-sm font-bold">
              เพิ่มแล้ว {sweep.filter((e) => ADDED_KINDS.has(e.outcome)).length} คน
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
                        className={`text-meta rounded-full px-2 py-0.5 font-semibold ${
                          NEEDS_ATTENTION.has(e.outcome)
                            ? "bg-attn-soft text-attn-ink"
                            : "bg-sunk text-ink-secondary"
                        }`}
                      >
                        {note}
                      </span>
                    ) : null}
                    {/* Spec 359 U1 — offered in the ROW, not as a modal: the SA
                        keeps sweeping the line and settles the amber rows when
                        the line is done. */}
                    {e.outcome === "other_team" ? (
                      <button
                        type="button"
                        onClick={() => onMoveHere(e.workerId)}
                        disabled={pending}
                        className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                      >
                        ย้ายมาทีมนี้
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
