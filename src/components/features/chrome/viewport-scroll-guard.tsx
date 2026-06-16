"use client";

// Spec 95 — iOS standalone PWA keyboard hardening. The body is LOCKED (spec 64:
// overflow:hidden; PageShell's <main> is the only scroller). When the iOS
// software keyboard closes, WebKit resizes the viewport back but does NOT repaint
// the locked scroller — the content (sticky header included) is present but blank
// until a scroll forces a repaint. The operator confirmed it: the screen recovers
// the moment you scroll, and a รีเฟรช clears it. So this is a missing-repaint
// glitch, not a stuck scroll position.
//
// This guard reproduces that recovering scroll the instant the keyboard closes —
// a 1px nudge and back, position-preserving — so the user never sees the blank
// frame. It leaves the scroll position untouched and is inert outside the
// keyboard-close moment. Renders nothing.

import { useEffect } from "react";

export function ViewportScrollGuard() {
  useEffect(() => {
    function isEditable(el: Element | null): boolean {
      if (!el) return false;
      return (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        (el as HTMLElement).isContentEditable
      );
    }

    function repaintScroller() {
      // Focus may have moved field-to-field with the keyboard still up — don't
      // nudge mid-edit (the caret-reveal scroll is iOS's job then).
      if (isEditable(document.activeElement)) return;
      const scroller = document.querySelector("main");
      if (!(scroller instanceof HTMLElement)) return;
      // Mirror the manual scroll that recovers it: nudge, then restore next
      // frame so the net position is unchanged but a repaint is forced.
      scroller.scrollBy(0, 1);
      requestAnimationFrame(() => scroller.scrollBy(0, -1));
    }

    function onFocusOut() {
      // Let the keyboard finish sliding down before nudging.
      window.setTimeout(repaintScroller, 100);
    }

    const vv = window.visualViewport;
    function onViewportResize() {
      // Keyboard closed = the visual viewport is (nearly) back to full height.
      if (vv && window.innerHeight - vv.height < 80) {
        window.setTimeout(repaintScroller, 50);
      }
    }

    document.addEventListener("focusout", onFocusOut);
    vv?.addEventListener("resize", onViewportResize);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", onViewportResize);
    };
  }, []);

  return null;
}
