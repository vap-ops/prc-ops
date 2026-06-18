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
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useKeyboardInset } from "./use-keyboard-inset";

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Spec 109: the same overlay shell can dock to the bottom (default — the
  // thumb-reachable mobile form) or slide in from the RIGHT (the desktop
  // "Airtable" record sidesheet). Right = full-height side panel.
  side?: "bottom" | "right";
  // Spec 126 (ADR 0046 Layer B): a RIGHT panel grows to a wide split on lg+
  // (document-first create-PO: doc preview left, form right). No effect on the
  // bottom variant (phone uses an in-panel doc/form toggle instead).
  wide?: boolean;
}

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  side = "bottom",
  wide = false,
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Lift the panel above the on-screen keyboard. The keyboard shrinks the
  // *visual* viewport (not the layout viewport), so a bottom-docked sheet ends
  // up behind it; we read that shrink and offset the panel by `inset` while
  // capping its height to the still-visible `viewportHeight`. No-op (inset 0)
  // when no keyboard is up or the browser lacks VisualViewport — static layout.
  const { inset, viewportHeight } = useKeyboardInset(open);

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
  // Portal to <body>: opened from inside a `sticky z-20` DetailHeader, an
  // in-place `fixed z-50` overlay is still capped at the header's stacking
  // context (z-20) page-wide, so the fixed capture bar (z-40) paints over it
  // (spec 94: "WP general information hidden behind camera button"). Rendering
  // at the document root lets z-50 win. Guarded for SSR (open starts false).
  if (typeof document === "undefined") return null;

  const isRight = side === "right";

  // When the keyboard is up, push the panel above it (bottom variant) and cap
  // its height to the visible viewport so its scroller — not the keyboard —
  // owns the overflow. The right (desktop side-sheet) variant only needs the
  // height cap. Undefined when no keyboard, so the Tailwind classes win.
  const panelStyle: React.CSSProperties | undefined =
    inset > 0
      ? isRight
        ? { maxHeight: viewportHeight }
        : { marginBottom: inset, maxHeight: viewportHeight }
      : undefined;

  // Center a newly-focused field within the panel scroller so the keyboard
  // never sits on top of the active input. Runs after paint (rAF) so the
  // inset/height have settled first. Ignores the panel itself (focus-on-open).
  function handleFocusCapture(e: React.FocusEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (!target.matches("input, textarea, select, [contenteditable='true']")) return;
    if (typeof target.scrollIntoView !== "function") return;
    requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className={`fixed inset-0 z-50 flex bg-black/50 ${
        isRight ? "items-stretch justify-end" : "items-end justify-center"
      }`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onFocus={handleFocusCapture}
        style={panelStyle}
        className={
          isRight
            ? `sheet-panel-right border-edge bg-card flex h-full w-full ${
                wide ? "max-w-md lg:max-w-5xl" : "max-w-md"
              } flex-col overflow-hidden rounded-l-2xl border shadow-2xl focus:outline-none`
            : "sheet-panel border-edge bg-card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none"
        }
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
    </div>,
    document.body,
  );
}
