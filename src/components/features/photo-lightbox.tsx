"use client";

// Tap-to-enlarge photo lightbox (spec 15 item D). 'use client' is
// justified: the component owns the open/close + position state and
// document-level key listeners.
//
// The trigger is a button-wrapped thumbnail that fills its parent (the
// strip tiles on the SA upload screen, PM review galleries, and the
// request-detail attachment thumbs). The overlay uses `fixed`
// positioning without a portal — none of the consuming screens put a
// transform/filter on an ancestor, so the overlay escapes the tiles'
// overflow-hidden clipping.
//
// Spec 50: an optional photo GROUP enables slide-between-photos — prev/
// next buttons, ArrowLeft/ArrowRight, and a horizontal swipe (≥ 48px
// pointer delta). Navigation is non-wrapping: ends are ends, wrap-around
// disorients. Without a group the component behaves exactly as before.

import { useEffect, useRef, useState } from "react";

const SWIPE_THRESHOLD_PX = 48;

interface ZoomablePhotoProps {
  src: string;
  /** Ordered full-size URLs of the surrounding strip (spec 50). Groups
   *  never span sections — the caller passes one strip's URLs only. */
  group?: ReadonlyArray<string>;
  /** This photo's position inside `group`. */
  groupIndex?: number;
}

export function ZoomablePhoto({ src, group, groupIndex }: ZoomablePhotoProps) {
  const [open, setOpen] = useState(false);
  // Position inside the group while the dialog is open. Re-initialized
  // on every open so a navigate-then-close never leaks into the next
  // open (the dialog always opens on the TAPPED photo).
  const [current, setCurrent] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const photos = group && group.length > 0 ? group : [src];
  const hasGroup = photos.length > 1;
  const shown = photos[Math.min(current, photos.length - 1)] ?? src;

  function openDialog() {
    setCurrent(groupIndex !== undefined && groupIndex >= 0 ? groupIndex : 0);
    setOpen(true);
  }

  function step(delta: -1 | 1) {
    setCurrent((prev) => Math.min(photos.length - 1, Math.max(0, prev + delta)));
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // step is stable in behavior (bounded by photos.length, constant
    // while open); photos.length covers the only real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, photos.length]);

  return (
    <>
      {/* Spec 36: ring-inset — thumbnail wrappers use overflow-hidden,
          which clipped the (keyboard-only) focus ring entirely. */}
      <button
        type="button"
        onClick={openDialog}
        aria-label="ดูรูปขยาย"
        className="block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-inset"
      >
        {/* Plain <img> — signed Supabase URLs; same call as the existing
            thumbnails (next/image would need a remotePatterns entry). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="รูปขยาย"
          onClick={() => setOpen(false)}
          onPointerDown={(e) => {
            pointerStart.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const start = pointerStart.current;
            pointerStart.current = null;
            if (!start || !hasGroup) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            // Horizontal intent only — a vertical drag is not a swipe.
            if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dy) > Math.abs(dx)) return;
            step(dx < 0 ? 1 : -1);
          }}
          className="fixed inset-0 z-50 flex touch-pan-y items-center justify-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shown}
            alt=""
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            className="max-h-[92vh] max-w-[95vw] rounded-md object-contain select-none"
          />
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
                disabled={current === 0}
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
                disabled={current === photos.length - 1}
                aria-label="รูปถัดไป"
                className="absolute top-1/2 right-2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/80 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-40"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  ›
                </span>
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="ปิด"
            className="absolute top-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/80 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
          </button>
        </div>
      )}
    </>
  );
}
