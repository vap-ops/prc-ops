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
// The action error message renders IN the sheet — the page-top alert sits
// behind this z-50 overlay and would be invisible while it is open.

import { MusterCamera } from "./muster-camera";

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
  addable: { id: string; name: string }[];
  message: string | null;
  pending: boolean;
  onScanDetected: (workerId: string) => void;
  onTapAdd: (workerId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={`สแกน/เพิ่มช่าง — ทีม ${leadName}`}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black/90 p-4"
    >
      <div className="mx-auto my-auto flex w-full max-w-md flex-col gap-4">
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
                    className="bg-sunk text-ink min-h-11 rounded-lg px-3 text-sm disabled:opacity-50"
                  >
                    {w.name}
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
