"use client";

// Spec 392 U2b — the seam that keeps Konva out of the main bundle.
//
// konva + react-konva are ~54 KB gz, which in a repo running on 16 runtime
// dependencies would immediately be the largest thing in it (spec §3). Only a
// manager who opens the zones route may pay for that, so the editor is reached
// exclusively through this dynamic, ssr:false import — pinned, with a repo-wide
// scan for static importers, in `zone-canvas-island.test.ts`.
//
// 'use client' justification (CLAUDE.md): next/dynamic({ ssr: false }) must be
// called from a Client Component. ssr:false is also load-bearing rather than an
// optimisation — react-konva reaches for `window` at import time.

import dynamic from "next/dynamic";
import type { ZoneCanvasProps } from "./zone-canvas-types";

const ZoneCanvas = dynamic(() => import("./zone-canvas").then((m) => m.ZoneCanvas), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-card border-edge bg-sunk text-ink-secondary text-meta border px-4 py-10 text-center"
      role="status"
    >
      กำลังโหลดผังโซน…
    </div>
  ),
});

export function ZoneCanvasLazy(props: ZoneCanvasProps) {
  return <ZoneCanvas {...props} />;
}
