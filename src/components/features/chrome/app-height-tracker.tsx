"use client";

// Spec 95 — iOS standalone PWA on-screen-keyboard height fix.
//
// THE CORRECT SIGNAL IS visualViewport, NOT innerHeight. On iOS the soft keyboard
// is a separate layer: the LAYOUT viewport never changes, so `window.innerHeight`
// stays constant and the window `resize` event does NOT fire when the keyboard
// opens/closes — only `window.visualViewport` reacts (its `.height` shrinks and its
// `resize` event fires). (Confirmed: martijnhols.nl OSK article, htmhell viewport
// guide, quirksmode.) An earlier attempt drove the height off innerHeight + window
// resize and could never respond to the keyboard at all.
//
// The locked layout (spec 64) is html/body/<main> all `h-full` (=100% = the
// constant layout viewport). When the keyboard opens, the visible area shrinks but
// the page does not, so iOS clips/pans the bottom and on close leaves a blank gap.
//
// Fix: publish the live visual-viewport height as the `--app-vh` CSS variable;
// PageShell's <main> is sized `height: var(--app-vh, 100%)`, so the scroller tracks
// the actually-visible area — it shrinks above the keyboard and restores to full
// when the keyboard closes. Driven by `visualViewport.resize`/`scroll` (+ window
// resize/orientationchange/pageshow and focusout as fallbacks), with a delayed
// re-read because iOS does not settle visualViewport.height immediately on close.
// This is a CSS variable only — NO transform (that reparents fixed chrome, the
// reverted regression) and no scroll manipulation.

import { useEffect } from "react";

const VAR = "--app-vh";

export function AppHeightTracker() {
  useEffect(() => {
    const vv = window.visualViewport;

    function apply() {
      const px = `${Math.round(vv ? vv.height : window.innerHeight)}px`;
      if (document.documentElement.style.getPropertyValue(VAR) !== px) {
        document.documentElement.style.setProperty(VAR, px);
      }
    }
    // iOS lags settling visualViewport.height when the keyboard closes — re-read
    // shortly after the event so the restored full height is picked up.
    function applySoon() {
      window.setTimeout(apply, 300);
    }
    function applyNowAndSoon() {
      apply();
      applySoon();
    }

    apply();

    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", applySoon);
    window.addEventListener("pageshow", apply);
    document.addEventListener("focusout", applySoon);
    vv?.addEventListener("resize", applyNowAndSoon);
    vv?.addEventListener("scroll", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", applySoon);
      window.removeEventListener("pageshow", apply);
      document.removeEventListener("focusout", applySoon);
      vv?.removeEventListener("resize", applyNowAndSoon);
      vv?.removeEventListener("scroll", apply);
    };
  }, []);

  return null;
}
