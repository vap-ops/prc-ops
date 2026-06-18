// Spec 140 (app-feel slice 5, motion) — staggered list-enter. Pure: returns the
// class + the row's capped stagger index (a CSS var the globals.css `.list-enter`
// keyframe reads for `animation-delay`). The keyframe is gated behind
// `prefers-reduced-motion: no-preference`, so reduced-motion users get static,
// fully-visible rows. The stagger is CAPPED so a long list's tail doesn't wait
// seconds — rows past the cap all share the last delay step.

import type { CSSProperties } from "react";

export const LIST_ENTER_STAGGER_CAP = 8;

export interface ListEnterProps {
  className: string;
  /** Carries `--enter-index` (the capped stagger step) for the keyframe delay. */
  style: CSSProperties;
}

export function listEnterProps(index: number): ListEnterProps {
  const step = Math.min(Math.max(Math.trunc(index), 0), LIST_ENTER_STAGGER_CAP);
  return {
    className: "list-enter",
    // React does not append px to custom properties, so the raw number is fine.
    style: { "--enter-index": step } as CSSProperties,
  };
}
