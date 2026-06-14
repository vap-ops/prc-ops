"use client";

// Spec 78 (app-feel slice 4) — BottomSheet: a thumb-reachable sheet that
// slides up from the bottom, the native pattern for an inline form. Same
// overlay language as ConfirmDialog / the lightbox (fixed inset-0 scrim, z-50,
// Escape + scrim-click close, content click stops propagation, role=dialog
// aria-modal). The caller owns the open state.
//
// The body is already LOCKED (spec 64: <body h-full overflow-hidden>), so the
// page behind the scrim can't scroll-leak on iOS. The panel is its own
// overscroll-contained scroller. Slide-up motion is CSS-only (.sheet-panel
// @keyframes in globals.css), gated by prefers-reduced-motion. Focus moves to
// the panel on open; a full tab-trap is a recorded seam (matches ConfirmDialog).

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function BottomSheet({ open, title, onClose, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus the panel on open only (callers pass inline onClose with a new
  // identity each render — refocusing on every re-render would yank focus).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="sheet-panel border-edge bg-card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none"
      >
        {/* Grab affordance + sticky header. */}
        <div className="border-edge flex flex-col items-center gap-2 border-b px-5 pt-2 pb-3">
          <span aria-hidden className="bg-edge-strong h-1 w-9 rounded-full" />
          <div className="flex w-full items-center justify-between gap-3">
            <h2 id={titleId} className="text-ink text-base font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="text-ink-muted hover:bg-sunk hover:text-ink focus-visible:ring-action -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 active:translate-y-px"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
