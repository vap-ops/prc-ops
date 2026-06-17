"use client";

// Spec 95 — iOS standalone PWA viewport-height restore. The layout is a locked
// h-full chain (spec 64: html/body h-full, body overflow-hidden, PageShell's
// <main> the only scroller). iOS shrinks the standalone web view for the soft
// keyboard, but does NOT recompute the CSS 100% (h-full) height when the keyboard
// closes — so html/body/<main> stay at the keyboard-reduced height and the content
// the keyboard vacated is left clipped with a blank gap at the bottom (operator
// screenshot, the "bottom blank gap"). rotate/navigate/refresh fix it because they
// force a fresh layout at the restored height.
//
// Fix: pin html + body height to the live window.innerHeight and re-apply on every
// resize / visualViewport resize / orientationchange / pageshow, so the
// keyboard-close resize restores the full height for real (instead of relying on
// iOS to recompute 100%, which it doesn't). <main>'s h-full follows the corrected
// root. Deliberately NOT a transform (that reparents every position:fixed element —
// see the reverted ViewportScrollGuard regression) and not a scroll change.

import { useEffect } from "react";

export function AppHeightTracker() {
  useEffect(() => {
    function apply() {
      const h = `${window.innerHeight}px`;
      if (document.documentElement.style.height !== h) document.documentElement.style.height = h;
      if (document.body.style.height !== h) document.body.style.height = h;
    }
    // Re-apply after the keyboard's slide finishes settling, where the immediate
    // resize can still read a mid-transition height.
    function applySoon() {
      window.setTimeout(apply, 100);
    }
    apply();

    const vv = window.visualViewport;
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", applySoon);
    window.addEventListener("pageshow", apply);
    document.addEventListener("focusout", applySoon);
    vv?.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", applySoon);
      window.removeEventListener("pageshow", apply);
      document.removeEventListener("focusout", applySoon);
      vv?.removeEventListener("resize", apply);
    };
  }, []);

  return null;
}
