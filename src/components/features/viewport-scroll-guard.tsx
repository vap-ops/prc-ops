"use client";

// Spec 95 — iOS standalone PWA keyboard hardening. The body is LOCKED (spec 64:
// overflow:hidden; PageShell is the only scroller). When the iOS software
// keyboard opens, WebKit scrolls the LOCKED document to reveal the caret and
// leaves it offset after the keyboard closes — the sticky header is pushed off
// the top, a blank band appears (above the fixed capture bar on the WP page),
// and overflow:hidden means the user can't scroll back. This guard snaps the
// document scroll back to 0 once the keyboard has closed. It leaves PageShell's
// scroll (the user's real content position) untouched, and is a no-op in every
// non-keyboard state — the locked document is always at 0. Renders nothing.

import { useEffect } from "react";

export function ViewportScrollGuard() {
  useEffect(() => {
    function resetDocumentScroll() {
      // Don't fight a live edit: focus may have moved field-to-field with the
      // keyboard still up — resetting now would hide the newly focused input.
      const a = document.activeElement;
      if (
        a &&
        (a.tagName === "INPUT" ||
          a.tagName === "TEXTAREA" ||
          a.tagName === "SELECT" ||
          (a as HTMLElement).isContentEditable)
      ) {
        return;
      }
      // The spurious offset lives on the document, not on PageShell.
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    }

    function onFocusOut() {
      // Let the keyboard finish sliding down before correcting.
      window.setTimeout(resetDocumentScroll, 100);
    }

    const vv = window.visualViewport;
    function onViewportResize() {
      // Keyboard closed = the visual viewport is (nearly) back to full height.
      if (vv && window.innerHeight - vv.height < 80) {
        window.setTimeout(resetDocumentScroll, 50);
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
