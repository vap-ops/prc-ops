"use client";

// CaptureSheet (Field-First) — the shutter sheet. A slide-up bottom sheet
// that owns the most-used interaction in the app: capture progress photos,
// fast, with gloves, in glare. Design wins over the old per-phase tiles:
//
//   • The CURRENT phase is pre-selected on open — zero taps to the right
//     bucket. Switching phase is one 56px target.
//   • A 104px amber shutter owns the thumb zone; `capture="environment"`
//     opens the rear camera directly. A secondary "เลือกจากคลังภาพ" input
//     (spec 96, no `capture`) adds the photo-library path.
//   • Captured shots stream into a grid: upload ring → check; the queue
//     auto-saves offline so you can keep shooting with no signal.
//
// The upload pipeline is unchanged — it comes from usePhaseCapture. The
// engine subtree is keyed by phase so switching clears the prior phase's
// pending tiles from view (the global queue runner still finishes them).

import { Camera, Check, Image as ImageIcon, X } from "lucide-react";
import { BUTTON_SECONDARY_MUTED, INLINE_ERROR } from "@/lib/ui/classes";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
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

/** Spec 248 U3 — paired-capture context: the defect photo this shot answers.
 *  The reference image renders AT FRAMING TIME (the "same angle" instruction
 *  is only actionable while the SA sees the original). */
export interface CapturePairing {
  defectPhotoId: string;
  referenceUrl: string | null;
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
  /** Spec 291 U1 — false once the WP is submitted for approval or complete:
   *  the in-detail delete affordance is not offered (RLS is the backstop). */
  canDelete: boolean;
  /** Spec 248 U3 — set when answering a defect photo: locks the sheet to
   *  after_fix, shows the reference, stamps answers_photo_id on the rows. */
  pairing?: CapturePairing | null;
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
  canDelete,
  pairing = null,
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

        {/* Phase switcher — hidden in paired mode (the answer is after_fix by
            definition; switching mid-pair would orphan the reference). */}
        {pairing === null ? (
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
        ) : (
          /* Spec 248 U3 — the reference at framing time: what to re-shoot,
             from the same angle. */
          <div className="border-attn bg-attn-soft rounded-card mb-4 flex items-center gap-3 border p-2.5">
            {pairing.referenceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL thumb
              <img
                src={pairing.referenceUrl}
                alt="รูปข้อบกพร่องที่ต้องแก้"
                className="border-edge h-20 w-20 shrink-0 rounded border object-cover"
              />
            ) : null}
            <p className="text-attn-ink text-sm font-semibold">
              ถ่ายรูปหลังแก้ไข <span className="font-extrabold">จากมุมเดิม</span>{" "}
              ของรูปข้อบกพร่องนี้
            </p>
          </div>
        )}

        {/* Engine subtree keyed by phase + pairing target: switching clears
            the prior context's pending tiles (the queue runner still
            completes them). */}
        <SheetCapture
          key={`${activePhase}-${pairing?.defectPhotoId ?? "free"}`}
          projectId={projectId}
          workPackageId={workPackageId}
          userId={userId}
          phase={pairing ? "after_fix" : activePhase}
          answersPhotoId={pairing?.defectPhotoId ?? null}
          photos={photos}
          canDelete={canDelete}
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
  answersPhotoId?: string | null;
  photos: ReadonlyArray<SheetPhoto>;
  canDelete: boolean;
}

function SheetCapture({
  projectId,
  workPackageId,
  userId,
  phase,
  answersPhotoId = null,
  photos,
  canDelete,
}: SheetCaptureProps) {
  const {
    pending,
    topLevelError,
    removingId,
    fileInputRef,
    handleFiles,
    retry,
    handleRemoveConfirmed,
  } = usePhaseCapture({ projectId, workPackageId, userId, phase, answersPhotoId });
  const hasContent = pending.length > 0 || photos.length > 0;

  // One lightbox group per phase (spec 50): the loaded photos in capture
  // order. A null-url tile (not yet displayable) is excluded from the
  // group but still renders its placeholder.
  const loaded = photos.filter((p) => p.url !== null);
  const loadedUrls = loaded.map((p) => p.url as string);
  const loadedPhotoIds = loaded.map((p) => p.id);
  const loadedIndexById = new Map<string, number>();
  loaded.forEach((p, i) => loadedIndexById.set(p.id, i));

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
                <LoadedTile
                  key={p.id}
                  photo={p}
                  group={loadedUrls}
                  groupPhotoIds={loadedPhotoIds}
                  groupIndex={loadedIndexById.get(p.id) ?? 0}
                  removingId={removingId}
                  onDelete={handleRemoveConfirmed}
                  canDelete={canDelete}
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
        {/* Spec 96: secondary path — pick an existing photo from the library.
            No `capture`, so iOS opens the gallery; same handleFiles engine. */}
        <label
          className={`${BUTTON_SECONDARY_MUTED} focus-within:ring-action mt-1 cursor-pointer gap-2 focus-within:ring-2`}
        >
          <ImageIcon aria-hidden className="h-5 w-5" />
          เลือกจากคลังภาพ
          <input
            type="file"
            accept={PHOTO_ACCEPT_MIME}
            multiple
            className="sr-only"
            onChange={(e) => {
              const input = e.currentTarget;
              // handleFiles resets only the camera input — clear ours so the
              // same gallery photo can be re-picked.
              void Promise.resolve(handleFiles(input.files)).finally(() => {
                input.value = "";
              });
            }}
          />
        </label>
      </div>
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

// A loaded photo is a tap-to-enlarge DETAIL trigger — delete lives inside
// that detail, never as a red × on the tile (feedback 7c3347b3), so an
// upload can't be wiped by a mis-tap and reads as permanent. The tiles in
// a phase form one lightbox group so the SA can swipe between them.
function LoadedTile({
  photo,
  group,
  groupPhotoIds,
  groupIndex,
  removingId,
  onDelete,
  canDelete,
}: {
  photo: SheetPhoto;
  group: ReadonlyArray<string>;
  groupPhotoIds: ReadonlyArray<string>;
  groupIndex: number;
  removingId: string | null;
  onDelete: (photoId: string) => void;
  canDelete: boolean;
}) {
  const isRemoving = removingId === photo.id;
  return (
    <li
      className={`rounded-control border-edge bg-sunk relative h-20 w-20 shrink-0 overflow-hidden border transition-opacity ${
        isRemoving ? "opacity-50" : ""
      }`}
    >
      {photo.url ? (
        <ZoomablePhoto
          src={photo.url}
          group={group}
          groupPhotoIds={groupPhotoIds}
          groupIndex={groupIndex}
          photoId={photo.id}
          canDelete={canDelete}
          onDeletePhoto={onDelete}
          deletingPhotoId={removingId}
        />
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
    </li>
  );
}
