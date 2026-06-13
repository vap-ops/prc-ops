"use client";

// Spec 76 (app-feel slice 1) — the toast viewport + provider. Mounted ONCE in
// the root layout WRAPPING {children}, so a toast fired immediately before a
// router.refresh() survives the RSC re-render (the provider never unmounts).
//
// a11y (review-driven): two PERSISTENT, always-mounted sr-only live regions are
// the announce channel — a polite region for success, an assertive one for
// errors. They exist on first paint and MUTATE when a message is added (each
// toast is a keyed child), so iOS VoiceOver reliably speaks it; a live region
// inserted already-containing its text is the classic silent-failure case. The
// visible pills are presentational.
//
// Positioning respects the verified z-stack (header 20 / queue 30 / tab bar 40
// / scrims 50): z-[45] floats above the tab bar + queue banner but below
// dialogs/lightbox, and clears the 64px phone tab bar + the safe-area inset.
// Enter motion is CSS-only (.toast-item @keyframes in globals.css), gated by
// prefers-reduced-motion. No navigator.vibrate — a verified no-op on iOS PWA.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ToastContext, type ToastApi, type ToastVariant } from "@/lib/ui/use-toast";
import { TOAST_ERROR, TOAST_SUCCESS } from "@/lib/ui/classes";

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

const MAX_STACK = 3;
const SUCCESS_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const idSeq = useRef(0);

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((t) => t.id !== id));
      clearTimer(id);
    },
    [clearTimer],
  );

  // Clear every pending timer if the provider ever unmounts (Fast Refresh,
  // tests, a future remount) — decouples timer hygiene from the never-unmount
  // root-layout invariant.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant, durationMs?: number) => {
      const id = String((idSeq.current += 1));
      setItems((prev) => {
        const next = [...prev, { id, message, variant }];
        if (next.length > MAX_STACK) {
          // Drop the oldest AND clear its timer so the map mirrors the stack.
          for (const dropped of next.slice(0, next.length - MAX_STACK)) clearTimer(dropped.id);
          return next.slice(next.length - MAX_STACK);
        }
        return next;
      });
      // Errors PERSIST until manually dismissed (WCAG 2.2.1 — a failure the
      // user must read shouldn't time out). Success auto-dismisses.
      if (variant !== "error") {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), durationMs ?? SUCCESS_MS),
        );
      }
      return id;
    },
    [clearTimer, dismiss],
  );

  const api: ToastApi = useMemo(
    () => ({
      toast: (message, opts) => push(message, opts?.variant ?? "success", opts?.durationMs),
      success: (message, opts) => push(message, "success", opts?.durationMs),
      error: (message, opts) => push(message, "error", opts?.durationMs),
      dismiss,
      fromResult: (result, okMessage) =>
        result.ok ? push(okMessage, "success") : push(result.error, "error"),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Persistent announce channel (sr-only). */}
      <div role="status" aria-live="polite" className="sr-only">
        {items
          .filter((t) => t.variant === "success")
          .map((t) => (
            <div key={t.id}>{t.message}</div>
          ))}
      </div>
      <div role="alert" aria-live="assertive" className="sr-only">
        {items
          .filter((t) => t.variant === "error")
          .map((t) => (
            <div key={t.id}>{t.message}</div>
          ))}
      </div>

      {/* Visible pills — presentational (the regions above do the announcing). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[45] mx-auto flex w-fit max-w-[90vw] flex-col items-center gap-2 sm:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast-item pointer-events-auto flex max-w-[90vw] items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium shadow-md ${
              t.variant === "error" ? TOAST_ERROR : TOAST_SUCCESS
            }`}
          >
            <span className="min-w-0 break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="ปิด"
              className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-current transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
