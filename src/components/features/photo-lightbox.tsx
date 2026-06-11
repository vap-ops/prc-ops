"use client";

// Tap-to-enlarge photo lightbox (spec 15 item D). 'use client' is
// justified: the component owns the open/close state and a document-level
// Escape listener.
//
// The trigger is a button-wrapped thumbnail that fills its parent (the
// existing aspect-square tiles on the SA upload screen and the PM review
// galleries). The overlay uses `fixed` positioning without a portal —
// none of the consuming screens put a transform/filter on an ancestor,
// so the overlay escapes the tiles' overflow-hidden clipping.

import { useEffect, useState } from "react";

interface ZoomablePhotoProps {
  src: string;
}

export function ZoomablePhoto({ src }: ZoomablePhotoProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ดูรูปขยาย"
        className="block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] max-w-[95vw] rounded-md object-contain"
          />
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
