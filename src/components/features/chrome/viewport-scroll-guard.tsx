"use client";

// Spec 95 — body-lock scroll guard (defense-in-depth).
//
// The PRIMARY iOS keyboard fix is `maximum-scale=1` in the root `viewport` export:
// the form fields are text-sm (14px) and iOS auto-zooms into any input < 16px on
// focus, then leaves the page zoomed + panned ("blank portion"); maximum-scale=1
// stops that at the root. THIS guard is the remaining defense for the spec-64 body
// lock invariant: the body is overflow:hidden (PageShell's <main> is the only
// scroller), so the DOCUMENT (documentElement / window) must always sit at scroll 0
// — but iOS can still scroll the documentElement to reveal a focused input near the
// bottom and not reset it on close, leaving the page shifted up. (During the
// auto-zoom bug this read window.scrollY = documentElement.scrollTop = 389.)
//
// So: when the keyboard is DOWN, force the document scroll back to 0. Gated on the
// keyboard being down (visualViewport.height ≈ innerHeight) so we never fight iOS
// revealing the input while the user is still typing. Only the document scroll is
// touched — never <main>'s (the reading position). No transform (that reparents
// fixed chrome — a reverted regression), no height changes. Cheap: a no-op whenever
// the document is already at 0, which is the normal case.

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
