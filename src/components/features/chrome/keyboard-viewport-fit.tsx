"use client";

// KeyboardViewportFit — keyboard-fit for the PAGE scroller (every non-sheet form).
//
// The body is locked (spec 64: <body overflow-hidden>) and PageShell's <main>
// (h-full overflow-y-auto) is the only scroller. h-full is the LAYOUT viewport
// height, which the soft keyboard does NOT shrink — so <main> runs *behind* the
// keyboard, and a field near the bottom of a long form is occluded with no room
// left to scroll it up (the scroller has already bottomed out). BottomSheet fixes
// this for sheet forms via useKeyboardInset, capping the panel; this is the same
// fix for the page scroller:
//
//   1. cap <main> to the band above the keyboard (keyboard-top y in layout coords
//      = innerHeight - inset), so its own overflow-y-auto ends at the keyboard
//      line and the focused field becomes reachable, and
//   2. centre the focused field within that capped scroller on focus.
//
// No-op (no inline height) with the keyboard down or without VisualViewport
// (desktop) — <main> keeps its h-full layout, so there is no regression. Sibling
// to ViewportScrollGuard (spec 95), which keeps the *document* at scroll 0; this
// only ever touches <main>'s inline height + scroll, never the document.

import { useEffect } from "react";

import { keyboardInset } from "@/lib/ui/keyboard-inset";

// Below this the shrink is viewport-chrome jitter, not a keyboard (matches the
// ViewportScrollGuard threshold).
const KEYBOARD_UP_PX = 100;

export function KeyboardViewportFit() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const scroller = () => document.querySelector("main");

    function fit() {
      const view = window.visualViewport;
      const el = scroller();
      if (!view || !el) return;
      const inset = keyboardInset(window.innerHeight, view.height, view.offsetTop);
      // Cap to the keyboard-top line so <main>'s scroller ends above the keyboard;
      // clear it when the keyboard is down so the h-full class layout returns.
      el.style.height = inset >= KEYBOARD_UP_PX ? `${window.innerHeight - inset}px` : "";
    }

    function centerFocused(e: FocusEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.matches?.("input, textarea, select, [contenteditable='true']")) return;
      if (typeof target.scrollIntoView !== "function") return;
      // Centre once after the next frame (the keyboard's resize fires fit() first)
      // and again after the slide settles, so it lands in the capped scroller.
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
      window.setTimeout(() => target.scrollIntoView({ block: "center" }), 300);
    }

    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    document.addEventListener("focusin", centerFocused);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      document.removeEventListener("focusin", centerFocused);
      const el = scroller();
      if (el) el.style.height = "";
    };
  }, []);

  return null;
}
