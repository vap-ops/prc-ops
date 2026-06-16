"use client";

// PhotoCaptureZone (Field-First) — the WP detail page's photo surface and
// the entry to the shutter. Replaces the three stacked per-phase
// PhaseUploader sections with:
//
//   • a three-tile phase switcher (current phase glows, passed phases
//     show a check, unreached phases a lock) — tap a tile to capture into
//     that phase;
//   • a recent strip for the current phase (lightbox preserved, spec
//     50/51 grouping);
//   • a fixed, thumb-anchored CAPTURE BAR (the page's hero action) that
//     opens the CaptureSheet pre-set to the current phase.
//
// All capture/upload/remove behavior lives in CaptureSheet + the shared
// usePhaseCapture engine — unchanged. This component is presentation +
// open/active-phase state. The file keeps its name for import stability;
// the detail page imports { PhotoCaptureZone }.

import { useState } from "react";
import { Camera, Check, Lock } from "lucide-react";
import { BUTTON_CAPTURE } from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photos/photo-strip";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import type { PhotoPhase } from "@/lib/photos/transitions";
import { CaptureSheet, type SheetPhoto } from "./capture-sheet";

interface ThumbnailPhoto {
  id: string;
  url: string | null;
  timeLabel: string | null;
}

export interface PhaseData {
  phase: PhotoPhase;
  label: string;
  photos: ReadonlyArray<ThumbnailPhoto>;
  lastUpdatedLabel: string | null;
}

interface PhotoCaptureZoneProps {
  projectId: string;
  workPackageId: string;
  userId: string;
  phases: ReadonlyArray<PhaseData>;
  /** The phase capture defaults to (server-derived from progress). */
  currentPhase: PhotoPhase;
}

export function PhotoCaptureZone({
  projectId,
  workPackageId,
  userId,
  phases,
  currentPhase,
}: PhotoCaptureZoneProps) {
  const [open, setOpen] = useState(false);
  const [activePhase, setActivePhase] = useState<PhotoPhase>(currentPhase);

  const order = phases.map((p) => p.phase);
  const currentIndex = order.indexOf(currentPhase);
  // phases is always the three photo phases; this guard narrows the fallback
  // for strict index access (noUncheckedIndexedAccess) without changing behavior.
  const fallback = phases[0];
  if (!fallback) throw new Error("PhotoCaptureZone requires at least one phase");
  const active = phases.find((p) => p.phase === activePhase) ?? fallback;

  function openSheet(phase: PhotoPhase) {
    setActivePhase(phase);
    setOpen(true);
  }

  const currentLabel = phases.find((p) => p.phase === currentPhase)?.label ?? "";
  const currentData = phases.find((p) => p.phase === currentPhase) ?? fallback;

  // Lightbox grouping (spec 50/51) for the current-phase strip.
  const stripPhotos = currentData.photos;
  const loadedUrls = stripPhotos.flatMap((p) => (p.url !== null ? [p.url] : []));
  const loadedPhotoIds = stripPhotos.flatMap((p) => (p.url !== null ? [p.id] : []));
  const loadedIndexById = new Map<string, number>();
  {
    let i = 0;
    for (const p of stripPhotos) if (p.url !== null) loadedIndexById.set(p.id, i++);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Phase switcher tiles */}
      <div className="grid grid-cols-3 gap-2">
        {phases.map((p, idx) => {
          const isCurrent = p.phase === currentPhase;
          const isPassed = idx < currentIndex; // an earlier phase the flow moved past
          const reached = idx <= currentIndex;
          return (
            <button
              key={p.phase}
              type="button"
              onClick={() => openSheet(p.phase)}
              aria-label={`ถ่ายรูป ${p.label}`}
              className={`rounded-card shadow-card focus-visible:ring-action relative flex flex-col items-start gap-2 border-[1.5px] px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 ${
                isCurrent
                  ? "border-attn bg-attn-soft ring-attn/25 ring-2"
                  : "border-edge bg-card hover:bg-sunk"
              }`}
            >
              {isCurrent && (
                <span className="border-card bg-attn text-on-attn absolute -top-2 right-2 rounded-full border-[1.5px] px-2 py-0.5 text-[0.625rem] font-extrabold">
                  ตอนนี้
                </span>
              )}
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full ${
                  isPassed
                    ? "bg-done-strong text-on-fill"
                    : isCurrent
                      ? "bg-attn text-on-attn"
                      : "border-edge-strong bg-card text-ink-muted border-2"
                }`}
              >
                {isPassed ? (
                  <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
                ) : reached ? null : (
                  <Lock aria-hidden className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="text-body text-ink font-bold">{p.label}</span>
              <span className="text-meta text-ink-secondary font-semibold">
                {p.photos.length > 0 ? `${p.photos.length} รูป` : "ยังไม่มีรูป"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Current-phase recent strip (lightbox preserved) */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-section text-ink font-bold">
            {currentLabel}
            {stripPhotos.length > 0 ? (
              <span className="text-meta text-ink-secondary ml-1.5 font-semibold">
                {stripPhotos.length} รูป
              </span>
            ) : null}
          </h3>
          {currentData.lastUpdatedLabel ? (
            <span className="text-meta text-ink-secondary font-semibold">
              ล่าสุด {currentData.lastUpdatedLabel}
            </span>
          ) : null}
        </div>
        <PhotoStrip>
          <li className="rounded-control border-edge-strong bg-card relative h-28 w-28 shrink-0 snap-start border-2 border-dashed">
            <button
              type="button"
              onClick={() => openSheet(currentPhase)}
              className="rounded-control hover:bg-sunk focus-visible:ring-action flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2"
            >
              <Camera aria-hidden className="text-attn-press h-6 w-6" />
              <span className="text-body text-attn-ink font-bold">ถ่ายเพิ่ม</span>
            </button>
          </li>
          {stripPhotos.map((p) => (
            <li key={p.id} className={PHOTO_STRIP_TILE}>
              {p.url ? (
                <ZoomablePhoto
                  src={p.url}
                  group={loadedUrls}
                  groupPhotoIds={loadedPhotoIds}
                  groupIndex={loadedIndexById.get(p.id) ?? 0}
                  photoId={p.id}
                />
              ) : (
                <div className="text-meta text-ink-secondary flex h-full w-full items-center justify-center">
                  ไม่พร้อมแสดง
                </div>
              )}
              {p.timeLabel ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-bold text-white">
                  {p.timeLabel}
                </span>
              ) : null}
            </li>
          ))}
        </PhotoStrip>
      </div>

      {/* HERO capture bar — fixed in the thumb zone (replaces the tab bar
          on this detail screen; the back chip handles return nav). */}
      <div className="border-edge bg-card shadow-up fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
        <div className={`mx-auto ${PAGE_MAX_W}`}>
          <button type="button" onClick={() => openSheet(currentPhase)} className={BUTTON_CAPTURE}>
            <Camera aria-hidden className="h-6 w-6" strokeWidth={2.4} />
            ถ่ายรูป
            <span className="text-meta font-bold opacity-80">· {currentLabel}</span>
          </button>
        </div>
      </div>
      {/* Spacer so page content clears the fixed capture bar. */}
      <div aria-hidden className="h-20" />

      <CaptureSheet
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        workPackageId={workPackageId}
        userId={userId}
        activePhase={activePhase}
        onPhaseChange={setActivePhase}
        phaseSummaries={phases.map((p) => ({
          phase: p.phase,
          label: p.label,
          count: p.photos.length,
        }))}
        photos={(active.photos as ReadonlyArray<SheetPhoto>) ?? []}
      />
    </div>
  );
}
