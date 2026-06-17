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

    // force=true skips the focused-field guard: used when the visual viewport has
    // already confirmed the keyboard is DOWN (a still-focused input is then the
    // recurrence to fix — iOS can close the keyboard via its Done/hide button
    // WITHOUT blurring the field, especially in multi-field forms; the locked
    // scroller never repaints and a portion stays blank). force=false keeps the
    // mid-edit guard for the focusout path (focus may be hopping field-to-field
    // with the keyboard still up — the caret-reveal scroll is iOS's job then).
    function repaintScroller(force: boolean) {
      if (!force && isEditable(document.activeElement)) return;
      const scroller = document.querySelector("main");
      if (!(scroller instanceof HTMLElement)) return;
      // (1) Mirror the manual scroll that recovers it: nudge, then restore next
      // frame so the net position is unchanged but a repaint is forced.
      scroller.scrollBy(0, 1);
      // (2) Scroll-INDEPENDENT repaint. scrollBy only forces a repaint when <main>
      // can actually scroll; a short form that fits the viewport (no overflow)
      // never moves, so the locked scroller stays blank — the recurrence that kept
      // freezing "for good". A 1px transform nudge re-rasterizes the layer
      // regardless of content height. Restored next frame → net position unchanged,
      // 1px shift invisible for a single frame. Preserves any existing transform.
      const prevTransform = scroller.style.transform;
      scroller.style.transform = prevTransform
        ? `${prevTransform} translateY(1px)`
        : "translateY(1px)";
      requestAnimationFrame(() => {
        scroller.scrollBy(0, -1);
        scroller.style.transform = prevTransform;
      });
    }

    function onFocusOut() {
      // Let the keyboard finish sliding down before nudging.
      window.setTimeout(() => repaintScroller(false), 100);
    }

    const vv = window.visualViewport;
    function onViewportResize() {
      // Keyboard closed = the visual viewport is (nearly) back to full height.
      // Repaint even if a field keeps focus (the recurrence): the keyboard is
      // measurably gone, so a position-preserving nudge is safe and needed.
      if (vv && window.innerHeight - vv.height < 80) {
        window.setTimeout(() => repaintScroller(true), 50);
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
