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

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Lock, RotateCcw } from "lucide-react";
import { BUTTON_CAPTURE, INLINE_ERROR } from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photos/photo-strip";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { reworkRoundTag } from "@/lib/photos/rework-round";
import type { PhotoPhase } from "@/lib/photos/transitions";
import { CaptureSheet, type CapturePairing, type SheetPhoto } from "./capture-sheet";
import { removePhoto } from "./actions";

/** Spec 248 U3 — one paired-capture slot: a current-round defect photo and
 *  its answer state (computed server-side from pairDefectPhotos + signed
 *  URLs, so this component stays presentation-only). */
export interface DefectPairSlot {
  defectPhotoId: string;
  defectUrl: string | null;
  answered: boolean;
  /** First current answer's signed URL (thumbnail), when answered. */
  answerUrl: string | null;
}

interface ThumbnailPhoto {
  id: string;
  url: string | null;
  seq: number;
  timeLabel: string | null;
  /** Display name of who uploaded the photo (feedback a6037564). Shown in
   *  the lightbox detail; null when the name can't be resolved. */
  uploaderName: string | null;
}

/**
 * Spec 341 U1 — one line of the removal trace.
 *
 * A FLAT list, not a field on PhaseData: `phases` is the four-tile capture list
 * and carries no `defect` entry, so hanging the trace off it silently dropped
 * every removed จุดบกพร่อง photo — the reviewer's evidence on a WP in rework,
 * i.e. the deletion that matters most. The zone travels on the line itself.
 */
export interface RemovedTrace {
  /** The removed photo's id — the render key; `seq` is not unique across zones. */
  id: string;
  zone: string;
  seq: number;
  byName: string | null;
  atLabel: string | null;
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
  /** Spec 353: offer the หลังแก้ไข CAPTURE shutter only inside a rework cycle
   *  (rework, or a reworked WP bounced for evidence) — never on a normal/complete WP. */
  showAfterFixCapture: boolean;
  /** Spec 353: show the READ-ONLY หลังแก้ไข history strip whenever the WP carries any
   *  after_fix photo, at any status — a completed WP keeps its record without a shutter. */
  showAfterFixHistory: boolean;
  /** Spec 216: the WP's current rework cycle (≥1 once reopened); the หลังแก้ไข tile
   *  captures into this round and is labelled with it. */
  currentReworkRound: number;
  /** Spec 291 U1 — passed to the CaptureSheet: false once the WP is submitted
   *  for approval or complete, so the in-detail delete is not offered. */
  canDelete: boolean;
  /** Spec 341 U1 — every removed photo on this WP, any zone. */
  removedTrace: ReadonlyArray<RemovedTrace>;
  /** Spec 248 U3 — the current round's defect photos + answer state; null
   *  outside a rework with defect photos. While any is unanswered, free
   *  after_fix capture redirects to the first open slot. */
  defectPairs?: ReadonlyArray<DefectPairSlot> | null;
}

export function PhotoCaptureZone({
  projectId,
  workPackageId,
  userId,
  phases,
  currentPhase,
  showAfterFixCapture,
  showAfterFixHistory,
  currentReworkRound,
  canDelete,
  removedTrace,
  defectPairs = null,
}: PhotoCaptureZoneProps) {
  const [open, setOpen] = useState(false);
  const [activePhase, setActivePhase] = useState<PhotoPhase>(currentPhase);
  const [pairing, setPairing] = useState<CapturePairing | null>(null);

  // Spec 356 — delete a progress photo straight from the WP-page viewer, not
  // only from inside the CaptureSheet. Reuses the existing removePhoto action
  // and the photo-lightbox overlay's own ลบรูป + confirm; this is just the glue
  // that runs the tombstone and refreshes, mirroring usePhaseCapture. The
  // overlay closes itself on confirm, so a refusal (locked WP, or a non-uploader
  // inside the ให้แก้ไข window — the action's gate is the authority) surfaces
  // here, on the page.
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [, startRemoveTransition] = useTransition();
  const removeErrorRef = useRef<HTMLDivElement>(null);

  async function handleDeletePhoto(photoLogId: string) {
    if (removingId !== null) return; // serialize — one tombstone round-trip at a time
    setRemoveError(null);
    setRemovingId(photoLogId);
    try {
      const result = await removePhoto({ photoLogId });
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
      startRemoveTransition(() => router.refresh());
    } catch {
      // A server-action invocation REJECTS (it never resolves to {ok:false}) on
      // a transport failure. Without this catch the throw would skip the
      // removingId reset in `finally` and wedge the concurrency guard — worse on
      // this surface than in the CaptureSheet, which unmounts and resets its
      // engine on close, whereas this zone stays mounted on the page. Same Thai
      // fallback the action itself uses for a transient tombstone failure.
      setRemoveError("ลบรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setRemovingId(null);
    }
  }

  // Spec 356 — the overlay closes itself on confirm, so a refusal lands on the
  // page while the user is looking at the strip, usually scrolled below this
  // banner. Bring it into view: the whole point of this feature is that a failed
  // delete must not read as a silent nothing. Guarded for jsdom (no scrollIntoView).
  useEffect(() => {
    if (removeError && typeof removeErrorRef.current?.scrollIntoView === "function") {
      removeErrorRef.current.scrollIntoView({ block: "center" });
    }
  }, [removeError]);

  const pairs = defectPairs ?? [];
  const unanswered = pairs.filter((p) => !p.answered);

  function openPaired(slot: DefectPairSlot) {
    setPairing({ defectPhotoId: slot.defectPhotoId, referenceUrl: slot.defectUrl });
    setActivePhase("after_fix");
    setOpen(true);
  }

  // after_fix is a rework addendum, NOT a 4th step in the before→during→after
  // chain — it renders on its own divided-off line, never inside the lifecycle
  // switcher grid (feedback: don't put it on the same row as the others).
  const lifecyclePhases = phases.filter((p) => p.phase !== "after_fix");
  // Spec 353: capture (shutter) only inside a rework cycle; otherwise a read-only
  // history strip when the WP still carries after_fix photos. Never both.
  const afterFixData = phases.find((p) => p.phase === "after_fix") ?? null;
  const afterFix = showAfterFixCapture ? afterFixData : null;
  const afterFixHistory = !showAfterFixCapture && showAfterFixHistory ? afterFixData : null;
  const order = lifecyclePhases.map((p) => p.phase);
  const currentIndex = order.indexOf(currentPhase);
  // phases is the photo-phase display list (PHASES); this guard narrows the
  // fallback for strict index access (noUncheckedIndexedAccess) without changing
  // behavior.
  const fallback = phases[0];
  if (!fallback) throw new Error("PhotoCaptureZone requires at least one phase");
  const active = phases.find((p) => p.phase === activePhase) ?? fallback;

  function openSheet(phase: PhotoPhase) {
    // Spec 248 U3 — CTA redirect: while any defect photo awaits its
    // same-angle answer, a free after_fix capture would produce a photo that
    // can never satisfy the pairing gate — route to the first open slot.
    const firstOpenSlot = unanswered[0];
    if (phase === "after_fix" && firstOpenSlot) {
      openPaired(firstOpenSlot);
      return;
    }
    setPairing(null);
    setActivePhase(phase);
    setOpen(true);
  }

  const currentLabel = phases.find((p) => p.phase === currentPhase)?.label ?? "";
  const currentData = phases.find((p) => p.phase === currentPhase) ?? fallback;

  // Lightbox grouping (spec 50/51) for the current-phase strip.
  const stripPhotos = currentData.photos;
  const loadedUrls = stripPhotos.flatMap((p) => (p.url !== null ? [p.url] : []));
  const loadedPhotoIds = stripPhotos.flatMap((p) => (p.url !== null ? [p.id] : []));
  const loadedUploaderNames = stripPhotos.flatMap((p) => (p.url !== null ? [p.uploaderName] : []));
  const loadedIndexById = new Map<string, number>();
  {
    let i = 0;
    for (const p of stripPhotos) if (p.url !== null) loadedIndexById.set(p.id, i++);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Spec 356 — a delete refusal (WP now locked, or a non-uploader inside the
          ให้แก้ไข window) surfaces here: the lightbox overlay has already closed
          itself on confirm, so the page is where the message must land. */}
      {removeError ? (
        <div ref={removeErrorRef} role="alert" className={INLINE_ERROR}>
          {removeError}
        </div>
      ) : null}
      {/* Spec 248 U3 — paired-capture slots: each current-round defect photo
          and its same-angle answer state. Renders ABOVE the phase tiles so
          the rework to-do list is the first thing the SA sees. */}
      {pairs.length > 0 ? (
        <div className="border-attn-soft bg-attn-soft/40 rounded-card border p-3">
          <h3 className="text-body text-attn-ink mb-2 font-extrabold">
            จุดบกพร่องที่ต้องแก้
            {unanswered.length > 0 ? (
              <span className="ml-1.5">
                (เหลือ {unanswered.length} จาก {pairs.length} จุด)
              </span>
            ) : (
              <span className="text-done-ink ml-1.5">— แก้ครบแล้ว</span>
            )}
          </h3>
          <ul className="flex flex-col gap-2">
            {pairs.map((slot) => (
              <li
                key={slot.defectPhotoId}
                className="border-edge bg-card rounded-control flex items-center gap-3 border px-3 py-2"
              >
                {slot.defectUrl ? (
                  <span className="border-edge relative block size-14 shrink-0 overflow-hidden rounded border">
                    <ZoomablePhoto src={slot.defectUrl} />
                  </span>
                ) : (
                  <span className="bg-sunk text-ink-muted border-edge flex size-14 shrink-0 items-center justify-center rounded border text-xs">
                    ไม่พร้อม
                  </span>
                )}
                {slot.answered ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="bg-done-strong text-on-fill flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                      <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="text-done-ink text-sm font-bold">แก้ไขแล้ว</span>
                    {slot.answerUrl ? (
                      <span className="border-edge relative ml-auto block size-14 shrink-0 overflow-hidden rounded border">
                        <ZoomablePhoto src={slot.answerUrl} />
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openPaired(slot)}
                    className="border-attn bg-attn-soft text-attn-ink rounded-control focus-visible:ring-action ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 border px-3 text-sm font-bold focus:outline-none focus-visible:ring-2"
                  >
                    <Camera aria-hidden className="h-4 w-4" />
                    ถ่ายรูปแก้ไข (มุมเดิม)
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Lifecycle phase switcher — the linear before→during→after sequence
          (a clean 3-up row; the lock chain + current glow live here). */}
      <div className="grid grid-cols-3 gap-2">
        {lifecyclePhases.map((p, idx) => {
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

      {/* หลังแก้ไข (after_fix) — a rework addendum, NOT a 4th sequential phase.
          Divided off onto its own line (feedback 0fa23307: don't sit it next to
          the before→during→after tiles). Always tappable: lock-free, never the
          derived "current" phase. Full-width so it never reads as a step. */}
      {afterFix && (
        <div className="border-edge border-t pt-3">
          <button
            type="button"
            onClick={() => openSheet(afterFix.phase)}
            aria-label={`ถ่ายรูป ${afterFix.label}`}
            className="rounded-card shadow-card border-edge bg-card hover:bg-sunk focus-visible:ring-action flex w-full items-center gap-3 border-[1.5px] px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2"
          >
            <span className="border-edge-strong bg-card text-ink-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2">
              <RotateCcw aria-hidden className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-body text-ink font-bold">{afterFix.label}</span>
              <span className="text-meta text-ink-secondary font-semibold">
                {/* Spec 216: name the cycle being captured into; a WP can be reworked
                    more than once, so "รอบ N" disambiguates the round. */}
                {currentReworkRound >= 1 ? `${reworkRoundTag(currentReworkRound)} · ` : ""}
                {afterFix.photos.length > 0
                  ? `${afterFix.photos.length} รูป`
                  : "ถ่ายเมื่อแก้ไขงานเสร็จ"}
              </span>
            </span>
          </button>
        </div>
      )}

      {/* Spec 353: read-only หลังแก้ไข history — a WP that left its rework cycle
          (submitted / complete) keeps its past after_fix photos visible, but with
          NO shutter (capture is rework-only). Never renders alongside afterFix. */}
      {afterFixHistory && (
        <div className="border-edge border-t pt-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="border-edge-strong bg-card text-ink-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2">
              <RotateCcw aria-hidden className="h-4 w-4" />
            </span>
            <h3 className="text-body text-ink font-bold">
              {afterFixHistory.label}
              <span className="text-meta text-ink-secondary ml-1.5 font-semibold">
                {afterFixHistory.photos.length} รูป
              </span>
            </h3>
          </div>
          <PhotoStrip>
            {afterFixHistory.photos.map((p) => (
              <li key={p.id} className={PHOTO_STRIP_TILE}>
                {p.url ? (
                  <ZoomablePhoto
                    src={p.url}
                    photoId={p.id}
                    uploaderName={p.uploaderName}
                    canDelete={canDelete}
                    onDeletePhoto={handleDeletePhoto}
                    deletingPhotoId={removingId}
                  />
                ) : (
                  <div className="text-meta text-ink-secondary flex h-full w-full items-center justify-center">
                    ไม่พร้อมแสดง
                  </div>
                )}
                <span className="pointer-events-none absolute top-0 left-0 rounded-br-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">
                  #{p.seq}
                </span>
              </li>
            ))}
          </PhotoStrip>
        </div>
      )}

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
                  groupUploaderNames={loadedUploaderNames}
                  groupIndex={loadedIndexById.get(p.id) ?? 0}
                  photoId={p.id}
                  uploaderName={p.uploaderName}
                  canDelete={canDelete}
                  onDeletePhoto={handleDeletePhoto}
                  deletingPhotoId={removingId}
                />
              ) : (
                <div className="text-meta text-ink-secondary flex h-full w-full items-center justify-center">
                  ไม่พร้อมแสดง
                </div>
              )}
              {/* Spec 340 U2 — the stable number, top-left so it survives a
                  screenshot cropped to the grid. */}
              <span className="pointer-events-none absolute top-0 left-0 rounded-br-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">
                #{p.seq}
              </span>
              {p.timeLabel ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-bold text-white">
                  {p.timeLabel}
                </span>
              ) : null}
            </li>
          ))}
        </PhotoStrip>

        {/* Spec 341 U1 — the removal trace. The operator's call was to keep
            pre-submit deletion open to any project member and buy accountability
            with VISIBILITY instead of an approval queue nobody would staff. The
            data was always there (photo_logs is append-only); nothing surfaced it.
            Spans EVERY zone, not just the selected one: a live probe found a WP
            whose six removals sat in ระหว่างทำ while the page opened on another
            tile, so a per-zone trace showed nothing at all. Accountability you
            have to go looking for is not accountability. Collapsed by default so
            a WP that never lost a photo reads clean. */}
        {removedTrace.length > 0 ? (
          <details className="mt-2">
            <summary className="text-meta text-ink-secondary flex min-h-11 cursor-pointer items-center">
              ลบไปแล้ว {removedTrace.length} รูป
            </summary>
            <ul className="text-meta text-ink-secondary mt-1 flex flex-col gap-0.5">
              {removedTrace.map((r) => (
                <li key={r.id}>
                  {r.zone} #{r.seq} · ลบโดย {r.byName ?? "ไม่ทราบชื่อ"}
                  {r.atLabel ? ` · ${r.atLabel}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
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
        onClose={() => {
          setOpen(false);
          setPairing(null);
        }}
        projectId={projectId}
        workPackageId={workPackageId}
        userId={userId}
        activePhase={activePhase}
        pairing={pairing}
        onPhaseChange={(phase) => {
          // Spec 248 U3 — the in-sheet switcher is ALSO a free after_fix
          // path: route it through the same pairing redirect as openSheet,
          // or a mid-sheet switch shoots unpaired photos the U4 gate can
          // never accept (review major, found by every lens).
          const firstOpenSlot = unanswered[0];
          if (phase === "after_fix" && firstOpenSlot) {
            openPaired(firstOpenSlot);
            return;
          }
          setPairing(null);
          setActivePhase(phase);
        }}
        phaseSummaries={phases.map((p) => ({
          phase: p.phase,
          label: p.label,
          count: p.photos.length,
        }))}
        photos={(active.photos as ReadonlyArray<SheetPhoto>) ?? []}
        canDelete={canDelete}
      />
    </div>
  );
}
