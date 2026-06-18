"use client";

// useKeyboardInset — live keyboard-occlusion metrics for a fixed / bottom-docked
// overlay, derived from the VisualViewport API. The soft keyboard shrinks the
// *visual* viewport (not the layout viewport), so a sheet pinned to the bottom
// of the layout viewport ends up *behind* the keyboard. We read that shrink as
// `inset` (px the keyboard covers, via the pure keyboardInset fn) plus the
// current `viewportHeight` (so the panel can cap its height to what's actually
// visible above the keyboard).
//
// SSR-safe: returns zeros until mounted. Degrades to a no-op (inset 0) on any
// browser without VisualViewport — the sheet just keeps its static layout, the
// pre-fix behaviour, so there's no regression where the API is missing.
//
// Distinct from spec 95 (iOS auto-zoom on <16px inputs, fixed via the viewport
// meta) and ViewportScrollGuard (body-scroll lock). This is purely the
// "lift the panel above the keyboard" measurement.

import { useEffect, useState } from "react";

import { keyboardInset } from "@/lib/ui/keyboard-inset";

interface KeyboardInset {
  // px the on-screen keyboard occludes at the bottom of the layout viewport.
  inset: number;
  // height of the still-visible viewport above the keyboard, or 0 before mount.
  viewportHeight: number;
}

export function useKeyboardInset(enabled: boolean): KeyboardInset {
  const [state, setState] = useState<KeyboardInset>({ inset: 0, viewportHeight: 0 });

  useEffect(() => {
    if (!enabled) return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    function measure() {
      // Re-read window.visualViewport each tick; `vv` is non-null here.
      const view = window.visualViewport;
      if (!view) return;
      setState({
        inset: keyboardInset(window.innerHeight, view.height, view.offsetTop),
        viewportHeight: Math.round(view.height),
      });
    }

    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, [enabled]);

  // Disabled → always zeros (no stale lift after a sheet closes); the effect
  // leaves `state` untouched on disable, so gate the value here, not in-effect.
  return enabled ? state : { inset: 0, viewportHeight: 0 };
}
