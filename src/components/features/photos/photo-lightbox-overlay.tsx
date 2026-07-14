"use client";

// The enlarged-photo view of the lightbox (spec 15 item D) — split out of
// photo-lightbox.tsx (audit 2026-06 rank 6) so this heavy half (markup
// canvas + comments + the photo-markups server actions) ships as its own
// lazily-fetched chunk instead of riding along with every thumbnail.
// 'use client' justification (CLAUDE.md): owns the position/markup/compose
// state, document-level key listeners, and pointer drawing capture.
//
// The overlay uses `fixed` positioning without a portal — none of the
// consuming screens put a transform/filter on an ancestor.
//
// Spec 50: a photo GROUP (photos.length > 1) enables slide-between-photos —
// prev/next buttons, ArrowLeft/ArrowRight, and a horizontal swipe (≥ 48px
// pointer delta). Navigation is non-wrapping.
//
// Spec 51: when the current photo carries a photo_logs id, markup UI
// appears — saved strokes render as a normalized SVG overlay on the
// image, comments list under it, and a compose mode captures finger
// drawing + a comment. Markup is overlay DATA — the photo bytes are
// never touched. Navigation is gated while composing.
//
// Raw zinc/red palette is intentionally allowed here (design-doctrine
// allowlist): this is always-dark chrome over the photo, independent of
// the app's light/dark theme — the theme-flipping tokens can't express it.

import { useEffect, useRef, useState, useTransition } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import {
  addPhotoMarkup,
  listPhotoMarkups,
  removePhotoMarkup,
  type PhotoMarkupRow,
} from "@/app/photo-markups/actions";
import { validatePhotoMarkup, type MarkupStroke } from "@/lib/photos/validate-markup";
import { formatThaiDateTime } from "@/lib/i18n/labels";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { useKeyboardInset } from "@/components/features/common/use-keyboard-inset";

const SWIPE_THRESHOLD_PX = 48;
const MAX_POINTS_PER_STROKE = 500;

export interface PhotoLightboxOverlayProps {
  /** Ordered full-size URLs of the strip; always at least one entry. */
  photos: ReadonlyArray<string>;
  /** Position to open on (the TAPPED photo). */
  initialIndex: number;
  /** photo_logs ids aligned with `photos` (null = markup off for that
   *  member). */
  photoIds: ReadonlyArray<string | null>;
  /** Uploader display names aligned with `photos` (null when unresolved). */
  uploaderNames: ReadonlyArray<string | null>;
  /** SA capture context: enables an in-detail delete affordance for the
   *  CURRENT photo (feedback 7c3347b3). */
  canDelete: boolean | undefined;
  onDeletePhoto: ((photoId: string) => void) | undefined;
  /** photo_logs id currently being removed (parent optimistic state). */
  deletingPhotoId: string | null | undefined;
  onClose: () => void;
}

export function PhotoLightboxOverlay({
  photos,
  initialIndex,
  photoIds,
  uploaderNames,
  canDelete,
  onDeletePhoto,
  deletingPhotoId,
  onClose,
}: PhotoLightboxOverlayProps) {
  // Position inside the group. The overlay mounts fresh on every open, so
  // it always opens on the TAPPED photo.
  const [current, setCurrent] = useState(initialIndex >= 0 ? initialIndex : 0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  // View-only rotation for landscape receipts (feedback 397dabaa). 90° steps,
  // applied to the image WRAPPER so a saved-markup SVG overlay rotates with the
  // photo (strokes stay aligned). The photo bytes are never touched. Drawing is
  // always captured at 0° (compose resets this), so normalizedPoint math never
  // sees a rotated box.
  const [rotation, setRotation] = useState(0);

  const hasGroup = photos.length > 1;
  const shown = photos[Math.min(current, photos.length - 1)] ?? "";
  const currentPhotoId = photoIds[current] ?? null;
  const currentUploaderName = uploaderNames[current] ?? null;

  // --- Markup state (spec 51) --------------------------------------------
  const [markupsByPhoto, setMarkupsByPhoto] = useState<Record<string, PhotoMarkupRow[]>>({});
  const [markupError, setMarkupError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draftStrokes, setDraftStrokes] = useState<MarkupStroke[]>([]);
  const [activePoints, setActivePoints] = useState<Array<readonly [number, number]>>([]);
  const [draftComment, setDraftComment] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  // Photo-level delete (feedback 7c3347b3) — distinct from the markup
  // (comment) removal above. Gated by `canDelete`; the confirm is its own
  // state so navigation/close can dismiss a pending prompt.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [busy, startBusy] = useTransition();
  const drawSurfaceRef = useRef<SVGSVGElement | null>(null);

  const markups = currentPhotoId ? markupsByPhoto[currentPhotoId] : undefined;

  useEffect(() => {
    if (!currentPhotoId || markupsByPhoto[currentPhotoId] !== undefined) return;
    let cancelled = false;
    void listPhotoMarkups({ photoLogId: currentPhotoId }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setMarkupsByPhoto((prev) => ({ ...prev, [currentPhotoId]: result.markups }));
      } else {
        setMarkupError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentPhotoId, markupsByPhoto]);

  function invalidateMarkups(id: string) {
    setMarkupsByPhoto((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function resetCompose() {
    setComposing(false);
    setDraftStrokes([]);
    setActivePoints([]);
    setDraftComment("");
    setSaveError(null);
  }

  function step(delta: -1 | 1) {
    // Dismiss a pending delete prompt — it targets the photo you're
    // leaving, never the one you land on.
    setConfirmDeleteOpen(false);
    // A fresh photo opens upright — rotation is per-photo, not sticky.
    setRotation(0);
    setCurrent((prev) => Math.min(photos.length - 1, Math.max(0, prev + delta)));
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Navigation is gated while composing — an arrow press must never
      // move the draft onto a different photo.
      if (composing) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // step is bounded by photos.length, constant while open; onClose is
    // a stable parent callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length, composing]);

  // --- Drawing capture (normalized to the displayed image box) -----------
  function normalizedPoint(e: React.PointerEvent): readonly [number, number] | null {
    const surface = drawSurfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [
      clamp((e.clientX - rect.left) / rect.width),
      clamp((e.clientY - rect.top) / rect.height),
    ];
  }

  function onDrawStart(e: React.PointerEvent) {
    if (!composing) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = normalizedPoint(e);
    if (p) setActivePoints([p]);
  }

  function onDrawMove(e: React.PointerEvent) {
    if (!composing || activePoints.length === 0) return;
    e.stopPropagation();
    const p = normalizedPoint(e);
    if (!p) return;
    setActivePoints((prev) => (prev.length >= MAX_POINTS_PER_STROKE ? prev : [...prev, p]));
  }

  function onDrawEnd(e: React.PointerEvent) {
    if (!composing) return;
    e.stopPropagation();
    setActivePoints((prev) => {
      if (prev.length >= 2) setDraftStrokes((s) => [...s, { points: prev }]);
      return [];
    });
  }

  function handleSave() {
    if (!currentPhotoId) return;
    const strokes = draftStrokes.length > 0 ? draftStrokes : null;
    const comment = draftComment.trim().length > 0 ? draftComment.trim() : null;
    const validated = validatePhotoMarkup({ strokes, comment });
    if (!validated.ok) {
      setSaveError(validated.error);
      return;
    }
    setSaveError(null);
    startBusy(async () => {
      const result = await addPhotoMarkup({ photoLogId: currentPhotoId, strokes, comment });
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      resetCompose();
      invalidateMarkups(currentPhotoId);
    });
  }

  function handleRemoveConfirmed(markupId: string) {
    setRemoveTarget(null);
    if (!currentPhotoId) return;
    startBusy(async () => {
      const result = await removePhotoMarkup({ markupId });
      if (!result.ok) {
        setMarkupError(result.error);
        return;
      }
      invalidateMarkups(currentPhotoId);
    });
  }

  // Photo-level delete (feedback 7c3347b3). Only the SA capture surface
  // passes `canDelete` + `onDeletePhoto`; the affordance applies to the
  // CURRENT photo and is hidden while composing markup (no delete mid-draw).
  const canDeleteCurrent =
    canDelete === true && currentPhotoId !== null && onDeletePhoto !== undefined && !composing;
  const isDeleting =
    deletingPhotoId !== null && deletingPhotoId !== undefined && deletingPhotoId === currentPhotoId;

  function handleDeleteConfirmed() {
    setConfirmDeleteOpen(false);
    if (currentPhotoId && onDeletePhoto) {
      onDeletePhoto(currentPhotoId);
      // The photo is gone — drop the detail back to the grid.
      onClose();
    }
  }

  const savedStrokes: MarkupStroke[] = (markups ?? []).flatMap((m) => m.strokes ?? []);
  const canSave = !busy && (draftStrokes.length > 0 || draftComment.trim().length > 0);

  // Keyboard occlusion (only the compose comment field summons it). The
  // overlay is `fixed inset-0` and centers its column — when the keyboard
  // shrinks the visual viewport, the comment editor (below the image) sits
  // behind it. With an inset we pad the overlay bottom and let it scroll from
  // the top so the focused field can be scrolled clear of the keyboard.
  const { inset } = useKeyboardInset(composing);

  // Center the comment field above the keyboard once it appears (rAF so the
  // inset has settled). Scrolls the overlay, not the page (body is locked).
  function centerOnFocus(e: React.FocusEvent<HTMLTextAreaElement>) {
    const field = e.target;
    if (typeof field.scrollIntoView !== "function") return;
    requestAnimationFrame(() => field.scrollIntoView({ block: "center" }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="รูปขยาย"
      onClick={onClose}
      onPointerDown={(e) => {
        pointerStart.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = pointerStart.current;
        pointerStart.current = null;
        if (!start || !hasGroup || composing) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        // Horizontal intent only — a vertical drag is not a swipe.
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dy) > Math.abs(dx)) return;
        step(dx < 0 ? 1 : -1);
      }}
      style={inset > 0 ? { paddingBottom: inset } : undefined}
      className={`fixed inset-0 z-50 flex touch-pan-y flex-col items-center gap-3 bg-black/85 p-4 ${
        inset > 0 ? "justify-start overflow-y-auto" : "justify-center"
      }`}
    >
      <span
        className="relative inline-flex"
        style={{ transform: `rotate(${rotation}deg)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Size caps swap at 90°/270° (feedback 397dabaa): a landscape receipt
            turned upright is taller than it is wide, so the element's max-WIDTH
            must bound the visual HEIGHT (and vice-versa) or the rotated image
            overflows a `justify-center` container that doesn't scroll. No
            transition on the wrapper — an instant snap avoids a mid-tween
            bounding box (which would misplace the first markup stroke). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shown}
          alt=""
          draggable={false}
          className="rounded-md object-contain select-none"
          style={
            rotation % 180 === 0
              ? { maxHeight: currentPhotoId ? "60vh" : "92vh", maxWidth: "95vw" }
              : { maxWidth: currentPhotoId ? "60vh" : "92vh", maxHeight: "95vw" }
          }
        />
        {currentPhotoId && (savedStrokes.length > 0 || composing) ? (
          /* Strokes are normalized to the displayed image box; the
             wrapper shrink-wraps the img, so inset-0 matches it. */
          <svg
            ref={drawSurfaceRef}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
            onPointerDown={onDrawStart}
            onPointerMove={onDrawMove}
            onPointerUp={onDrawEnd}
            className={`absolute inset-0 h-full w-full ${
              composing ? "cursor-crosshair touch-none" : "pointer-events-none"
            }`}
          >
            {[...savedStrokes, ...(composing ? draftStrokes : [])].map((stroke, i) => (
              <polyline
                key={i}
                points={stroke.points.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke="#dc2626"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {composing && activePoints.length >= 2 ? (
              <polyline
                points={activePoints.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke="#dc2626"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
        ) : null}
      </span>

      {currentUploaderName ? (
        <p
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-xl text-center text-xs text-zinc-300"
        >
          ถ่ายโดย <span className="font-semibold text-zinc-100">{currentUploaderName}</span>
        </p>
      ) : null}

      {currentPhotoId ? (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          className="max-h-[32vh] w-full max-w-xl overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950/90 p-3 text-zinc-100 backdrop-blur-sm"
        >
          {composing ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-400">
                ลากนิ้วบนรูปเพื่อวาด แล้วพิมพ์ความเห็นด้านล่าง
              </p>
              <label htmlFor="markup-comment" className="sr-only">
                ความเห็น
              </label>
              <textarea
                id="markup-comment"
                value={draftComment}
                maxLength={1000}
                rows={2}
                disabled={busy}
                onChange={(e) => setDraftComment(e.target.value)}
                onFocus={centerOnFocus}
                placeholder="ความเห็น เช่น ตรงนี้ต้องเก็บงานเพิ่ม"
                className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
              />
              {saveError ? (
                <p role="alert" className="text-xs font-medium text-red-400">
                  {saveError}
                </p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraftStrokes((s) => s.slice(0, -1))}
                  disabled={busy || draftStrokes.length === 0}
                  className="inline-flex min-h-11 items-center rounded-md border border-zinc-600 bg-zinc-900 px-3 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-40"
                >
                  ย้อนเส้นล่าสุด
                </button>
                <button
                  type="button"
                  onClick={resetCompose}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center rounded-md border border-zinc-600 bg-zinc-900 px-3 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="inline-flex min-h-11 items-center rounded-md bg-white px-4 text-xs font-semibold text-zinc-900 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-zinc-300">
                  ความเห็น{markups && markups.length > 0 ? ` (${markups.length})` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMarkupError(null);
                    // Draw on the upright photo — strokes are normalized to the
                    // 0° box, so entering compose must clear any view rotation.
                    setRotation(0);
                    setComposing(true);
                  }}
                  className="inline-flex min-h-11 items-center rounded-md border border-zinc-600 bg-zinc-900 px-3 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
                >
                  วาดและความเห็น
                </button>
              </div>
              {markupError ? (
                <p role="alert" className="text-xs font-medium text-red-400">
                  {markupError}
                </p>
              ) : null}
              {markups === undefined && !markupError ? (
                <p className="text-xs text-zinc-400">กำลังโหลด…</p>
              ) : null}
              {markups && markups.length === 0 ? (
                <p className="text-xs text-zinc-400">ยังไม่มีความเห็นบนรูปนี้</p>
              ) : null}
              {(markups ?? []).map((m) => (
                <div
                  key={m.id}
                  className="flex items-start justify-between gap-2 border-t border-zinc-800 pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-400">
                      <span className="font-medium text-zinc-200">{m.createdByName}</span>
                      <span className="mx-1">·</span>
                      {formatThaiDateTime(m.createdAt)}
                      {m.strokes && m.strokes.length > 0 ? (
                        <span className="ml-1 text-red-400">✎</span>
                      ) : null}
                    </p>
                    {m.comment ? (
                      <p className="text-sm whitespace-pre-wrap text-zinc-100">{m.comment}</p>
                    ) : null}
                  </div>
                  {m.isMine ? (
                    <button
                      type="button"
                      onClick={() => setRemoveTarget(m.id)}
                      disabled={busy}
                      aria-label="ลบความเห็น"
                      className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-xs font-medium text-red-400 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-40"
                    >
                      ลบ
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {hasGroup ? (
        <>
          <span
            aria-live="polite"
            className="absolute top-3 left-3 rounded-full border border-zinc-700 bg-zinc-950/80 px-2.5 py-1 text-xs font-medium text-zinc-100 backdrop-blur-sm"
          >
            {current + 1}/{photos.length}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            disabled={current === 0 || composing}
            aria-label="รูปก่อนหน้า"
            className="absolute top-1/2 left-2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/80 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-40"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ‹
            </span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            disabled={current === photos.length - 1 || composing}
            aria-label="รูปถัดไป"
            className="absolute top-1/2 right-2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/80 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-40"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ›
            </span>
          </button>
        </>
      ) : null}
      {/* Photo delete lives HERE, in the detail view — never on the
          grid thumbnail (feedback 7c3347b3). Top-center: clear of the
          group counter (top-left) and the close button (top-right). */}
      {canDeleteCurrent ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDeleteOpen(true);
          }}
          disabled={isDeleting}
          className="absolute top-3 left-1/2 inline-flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full border border-red-500/60 bg-zinc-950/80 px-3.5 text-xs font-semibold text-red-300 backdrop-blur-sm transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
        >
          {isDeleting ? (
            <span
              aria-hidden="true"
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-300/40 border-t-red-300"
            />
          ) : (
            <Trash2 aria-hidden className="h-4 w-4" />
          )}
          ลบรูป
        </button>
      ) : null}
      {/* Rotate a landscape receipt into a readable orientation (feedback
          397dabaa) — view-only, 90° per tap. Hidden while composing markup so
          drawing is only ever captured on the upright photo. Sits left of the
          close button (top-right). */}
      {!composing ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRotation((r) => (r + 90) % 360);
          }}
          aria-label="หมุนรูป"
          className="absolute top-3 right-16 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/80 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
        >
          <RotateCw aria-hidden className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="ปิด"
        className="absolute top-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/80 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          ×
        </span>
      </button>
      {/* Wrapper stops clicks inside the confirm overlay from
          bubbling to the lightbox backdrop handler (which would
          close the lightbox underneath the dialog). */}
      <span
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <ConfirmDialog
          open={removeTarget !== null}
          message={"ลบความเห็นนี้หรือไม่? การลบไม่สามารถย้อนกลับได้"}
          confirmLabel="ลบความเห็น"
          onConfirm={() => {
            if (removeTarget) handleRemoveConfirmed(removeTarget);
          }}
          onCancel={() => setRemoveTarget(null)}
        />
      </span>
      {/* Photo delete confirm (feedback 7c3347b3) — same stop-bubbling
          wrapper so the prompt's own backdrop doesn't close the lightbox. */}
      <span
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <ConfirmDialog
          open={confirmDeleteOpen}
          message={"ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้"}
          confirmLabel="ลบรูป"
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setConfirmDeleteOpen(false)}
        />
      </span>
    </div>
  );
}
