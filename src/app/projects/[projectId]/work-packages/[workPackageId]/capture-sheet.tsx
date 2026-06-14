"use client";

// CaptureSheet (Field-First) — the shutter sheet. A slide-up bottom sheet
// that owns the most-used interaction in the app: capture progress photos,
// fast, with gloves, in glare. Design wins over the old per-phase tiles:
//
//   • The CURRENT phase is pre-selected on open — zero taps to the right
//     bucket. Switching phase is one 56px target.
//   • A 104px amber shutter owns the thumb zone; `capture="environment"`
//     opens the rear camera directly (no gallery detour).
//   • Captured shots stream into a grid: upload ring → check; the queue
//     auto-saves offline so you can keep shooting with no signal.
//
// The upload pipeline is unchanged — it comes from usePhaseCapture. The
// engine subtree is keyed by phase so switching clears the prior phase's
// pending tiles from view (the global queue runner still finishes them).

import { Camera, Check, X } from "lucide-react";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { PHOTO_ACCEPT_MIME } from "@/lib/photos/path";
import type { PhotoPhase } from "@/lib/photos/transitions";
import { usePhaseCapture, type PendingUpload } from "./use-phase-capture";

export interface SheetPhoto {
  id: string;
  url: string | null;
  timeLabel: string | null;
}

export interface PhaseSummary {
  phase: PhotoPhase;
  label: string;
  count: number;
}

interface CaptureSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  workPackageId: string;
  userId: string;
  activePhase: PhotoPhase;
  onPhaseChange: (phase: PhotoPhase) => void;
  phaseSummaries: ReadonlyArray<PhaseSummary>;
  /** Loaded photos for the ACTIVE phase (server data). */
  photos: ReadonlyArray<SheetPhoto>;
}

export function CaptureSheet({
  open,
  onClose,
  projectId,
  workPackageId,
  userId,
  activePhase,
  onPhaseChange,
  phaseSummaries,
  photos,
}: CaptureSheetProps) {
  if (!open) return null;
  const activeLabel = phaseSummaries.find((p) => p.phase === activePhase)?.label ?? "";
  return (
    // Spec 62 z-stack: scrim 50 sits above headers/tabs.
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="ปิด"
        onClick={onClose}
        className="bg-ink/55 absolute inset-0"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`ถ่ายรูป ${activeLabel}`}
        className="sheet-panel bg-card shadow-pop relative flex max-h-[88vh] flex-col rounded-t-[var(--radius-sheet)] px-4 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <span aria-hidden className="bg-edge-strong mx-auto mt-1.5 mb-3 h-1.5 w-10 rounded-full" />
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="text-heading text-ink font-extrabold">ถ่ายรูปความคืบหน้า</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-control border-edge bg-card text-ink-secondary hover:bg-sunk focus-visible:ring-action inline-flex h-11 w-11 items-center justify-center border transition-colors focus:outline-none focus-visible:ring-2"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>

        {/* Phase switcher — three big 56px targets; current pre-selected. */}
        <div role="radiogroup" aria-label="เลือกช่วงงาน" className="mb-4 flex gap-2">
          {phaseSummaries.map(({ phase, label, count }) => {
            const on = phase === activePhase;
            return (
              <button
                key={phase}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPhaseChange(phase)}
                className={`rounded-card text-body focus-visible:ring-action flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 border-2 font-extrabold transition-colors focus:outline-none focus-visible:ring-2 ${
                  on
                    ? "border-attn bg-attn-soft text-attn-ink ring-attn/25 ring-2"
                    : "border-edge bg-card text-ink-secondary"
                }`}
              >
                {label}
                <span
                  className={`text-meta font-bold ${on ? "text-attn-press" : "text-ink-muted"}`}
                >
                  {count} รูป
                </span>
              </button>
            );
          })}
        </div>

        {/* Engine subtree keyed by phase: switching clears the prior
            phase's pending tiles (the queue runner still completes them). */}
        <SheetCapture
          key={activePhase}
          projectId={projectId}
          workPackageId={workPackageId}
          userId={userId}
          phase={activePhase}
          photos={photos}
        />
      </div>
    </div>
  );
}

interface SheetCaptureProps {
  projectId: string;
  workPackageId: string;
  userId: string;
  phase: PhotoPhase;
  photos: ReadonlyArray<SheetPhoto>;
}

function SheetCapture({ projectId, workPackageId, userId, phase, photos }: SheetCaptureProps) {
  const {
    pending,
    topLevelError,
    removingId,
    confirmRemoveId,
    fileInputRef,
    handleFiles,
    retry,
    requestRemove,
    cancelRemove,
    handleRemoveConfirmed,
  } = usePhaseCapture({ projectId, workPackageId, userId, phase });
  const hasContent = pending.length > 0 || photos.length > 0;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {topLevelError && (
          <div role="alert" className={`mb-3 ${INLINE_ERROR}`}>
            {topLevelError}
          </div>
        )}
        {hasContent ? (
          <>
            <p className="text-meta text-ink-secondary mb-2 font-bold">รูปในช่วงนี้</p>
            <ul className="flex flex-wrap gap-2">
              {pending.map((up) => (
                <PendingThumb key={up.id} upload={up} onRetry={() => void retry(up.id)} />
              ))}
              {photos.map((p) => (
                <LoadedThumb
                  key={p.id}
                  photo={p}
                  isRemoving={removingId === p.id}
                  onRemove={() => requestRemove(p.id)}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="text-body text-ink-secondary py-6 text-center">
            ยังไม่มีรูปในช่วงนี้ — แตะปุ่มถ่ายด้านล่าง
          </p>
        )}
      </div>

      {/* Shutter — owns the thumb zone. capture="environment" → rear cam. */}
      <div className="flex flex-col items-center gap-2.5 pt-4">
        <label className="shutter-live border-card bg-attn text-on-attn focus-within:ring-action flex h-26 w-26 cursor-pointer items-center justify-center rounded-full border-[6px] shadow-[0_0_0_3px_var(--color-attn),0_10px_24px_-6px_rgb(180_117_11_/_0.6)] transition-transform focus-within:ring-2 active:scale-95">
          <Camera aria-hidden className="h-10 w-10" strokeWidth={2.2} />
          <input
            ref={fileInputRef}
            type="file"
            accept={PHOTO_ACCEPT_MIME}
            capture="environment"
            multiple
            className="sr-only"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <span className="sr-only">ถ่ายรูป</span>
        </label>
        <p className="text-meta text-ink-secondary font-semibold">แตะเพื่อถ่าย</p>
        <p className="text-meta text-ink-muted flex items-center gap-1.5">
          <Check aria-hidden className="text-done-strong h-3.5 w-3.5" strokeWidth={3} />
          บันทึกอัตโนมัติ — ถ่ายต่อได้แม้ไม่มีเน็ต
        </p>
      </div>

      <ConfirmDialog
        open={confirmRemoveId !== null}
        message={"ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้"}
        confirmLabel="ลบรูป"
        onConfirm={() => {
          if (confirmRemoveId) void handleRemoveConfirmed(confirmRemoveId);
        }}
        onCancel={cancelRemove}
      />
    </>
  );
}

function PendingThumb({ upload, onRetry }: { upload: PendingUpload; onRetry: () => void }) {
  const isError = upload.status === "upload-error" || upload.status === "insert-error";
  const inProgress = upload.status === "uploading" || upload.status === "inserting";
  return (
    <li className="rounded-control border-edge relative h-20 w-20 shrink-0 overflow-hidden border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={upload.previewUrl} alt="" className="h-full w-full object-cover opacity-60" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-1 text-center">
        {inProgress && (
          <span
            aria-hidden
            className="border-card/50 border-t-card inline-block h-6 w-6 animate-spin rounded-full border-[3px]"
          />
        )}
        {isError && (
          <button
            type="button"
            onClick={onRetry}
            className="border-edge-strong bg-card text-meta text-danger-ink inline-flex min-h-11 items-center rounded border px-2 font-bold"
          >
            ลองใหม่
          </button>
        )}
      </div>
    </li>
  );
}

function LoadedThumb({
  photo,
  isRemoving,
  onRemove,
}: {
  photo: SheetPhoto;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-control border-edge bg-sunk relative h-20 w-20 shrink-0 overflow-hidden border">
      {photo.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-meta text-ink-secondary flex h-full w-full items-center justify-center">
          ไม่พร้อม
        </span>
      )}
      {photo.timeLabel ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1 pt-3 pb-0.5 text-right text-[11px] font-bold text-white">
          {photo.timeLabel}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label="ลบรูป"
        className="focus-visible:ring-action absolute top-0 right-0 inline-flex h-11 w-11 items-center justify-center focus:outline-none focus-visible:ring-2 disabled:opacity-50"
      >
        <span className="border-danger-ink bg-danger text-on-fill inline-flex h-6 w-6 items-center justify-center rounded-full border">
          {isRemoving ? (
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          ) : (
            <span aria-hidden className="text-sm leading-none">
              ×
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
