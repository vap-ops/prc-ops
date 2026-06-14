"use client";

// Themed confirm dialog (spec 18) replacing window.confirm — the native
// dialog shows English browser chrome with a raw origin string, the
// least app-like moment in the flow. 'use client' is justified: Escape
// listener + initial-focus management. Same overlay language as the
// photo lightbox. The caller owns the open state.

import { useEffect, useId, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  // Initial focus keys on `open` only — callers pass inline callbacks
  // (new identity per render), and refocusing on every parent re-render
  // would yank focus from a user who tabbed to the confirm button.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={messageId}
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-control border-edge-strong bg-card w-full max-w-sm border p-5"
      >
        <p id={messageId} className="text-ink text-sm whitespace-pre-wrap">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="border-edge-strong bg-card text-ink hover:bg-page focus-visible:ring-action inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="bg-danger text-on-fill hover:bg-danger-strong focus-visible:ring-danger inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
