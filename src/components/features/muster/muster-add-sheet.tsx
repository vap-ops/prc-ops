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

export function MusterAddSheet({
  leadName,
  hasCamera,
  showTapAdd,
  addable,
  message,
  pending,
  onScanDetected,
  onTapAdd,
  onClose,
}: {
  leadName: string;
  hasCamera: boolean;
  /** เข้า + regular mode — the only mode where the tap-add list applies. */
  showTapAdd: boolean;
  addable: { id: string; name: string; gender: WorkerGender | null }[];
  message: string | null;
  pending: boolean;
  onScanDetected: (workerId: string) => void;
  onTapAdd: (workerId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

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
        {hasCamera ? <MusterCamera onDetected={onScanDetected} /> : null}

        {message ? (
          <p role="alert" className="bg-danger-soft text-danger-ink rounded-card px-3 py-2 text-sm">
            {message}
          </p>
        ) : null}

        {showTapAdd ? (
          <div className="bg-card rounded-card flex flex-col gap-2 p-3">
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
