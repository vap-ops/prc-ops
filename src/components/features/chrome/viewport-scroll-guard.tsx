"use client";

// Spec 95 — iOS standalone PWA keyboard scroll fix (evidence-based, from on-device
// metrics 2026-06-17).
//
// The body is LOCKED (spec 64: overflow:hidden; PageShell's <main> is the only
// scroller), so the DOCUMENT (documentElement / window) must always sit at scroll 0.
// But on iOS, opening the soft keyboard makes the system scroll the documentElement
// to bring the focused input into view, and it does NOT reset that scroll when the
// keyboard closes. Measured on device with the keyboard already down:
//
//     window.scrollY = 389   document.documentElement.scrollTop = 389
//
// i.e. the whole page is left shifted up ~389px, which is exactly the blank gap at
// the bottom the operator saw (the content the keyboard pushed up never came back
// down). <main>'s own scrollTop (the reading position) is correct and separate.
//
// Fix: when the keyboard is DOWN, force the document scroll back to 0. Gated on the
// keyboard being down (visualViewport.height ≈ innerHeight) so we never fight iOS
// revealing the input while the user is still typing. Only the document scroll is
// touched — never <main>'s. No transform (that reparents fixed chrome — a reverted
// regression), no height changes.

import { useEffect } from "react";

export function ViewportScrollGuard() {
  useEffect(() => {
    function keyboardDown(): boolean {
      const vv = window.visualViewport;
      if (!vv) return true;
      // innerHeight is the stable layout viewport on iOS (the keyboard does not
      // resize it); vv.height shrinks while the keyboard is up. Small delta = down.
      return window.innerHeight - vv.height < 100;
    }

    function resetDocScroll() {
      if (!keyboardDown()) return;
      const doc = document.documentElement;
      if (doc.scrollTop !== 0) doc.scrollTop = 0;
      if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    }

    // iOS settles the visual viewport late when the keyboard closes — re-reset
    // across the slide so the final settled state lands at scroll 0.
    function resetSoon() {
      resetDocScroll();
      window.setTimeout(resetDocScroll, 300);
      window.setTimeout(resetDocScroll, 600);
    }

    const vv = window.visualViewport;
    document.addEventListener("focusout", resetSoon);
    window.addEventListener("orientationchange", resetSoon);
    window.addEventListener("pageshow", resetSoon);
    vv?.addEventListener("resize", resetSoon);
    vv?.addEventListener("scroll", resetDocScroll);
    return () => {
      document.removeEventListener("focusout", resetSoon);
      window.removeEventListener("orientationchange", resetSoon);
      window.removeEventListener("pageshow", resetSoon);
      vv?.removeEventListener("resize", resetSoon);
      vv?.removeEventListener("scroll", resetDocScroll);
    };
  }, []);

  return null;
}
