// PhaseProgressBar (spec 54): three segments — emerald = phase passed,
// amber = current phase, sunk = not reached — captioned with the
// done-count and the current phase label. Pure presentation over
// derivePhaseProgress; server-renderable.
//
// Field-First: segments thickened to h-2.5 for outdoor legibility;
// canon colours (positive=emerald, current=amber, NEVER blue-700 which
// is reserved for links/active-nav) now resolve through tokens.

import { derivePhaseProgress, PHASE_ORDER } from "@/lib/photos/phase-progress";
import type { PhotoPhase } from "@/lib/photos/phase-progress";
import { PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";

const SEGMENT_CLASS = {
  complete: "bg-done",
  current: "bg-attn",
  empty: "bg-sunk",
} as const;

interface PhaseProgressBarProps {
  counts: Record<PhotoPhase, number>;
}

export function PhaseProgressBar({ counts }: PhaseProgressBarProps) {
  const progress = derivePhaseProgress(counts);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2" aria-hidden="true">
        {progress.segments.map((segment, i) => (
          <span
            key={PHASE_ORDER[i] ?? i}
            className={`h-2.5 flex-1 rounded-full ${SEGMENT_CLASS[segment]}`}
          />
        ))}
      </div>
      <p className="text-body text-ink-secondary">
        ความคืบหน้ารูปถ่าย{" "}
        <span className="text-ink font-bold">{progress.doneCount} จาก 3 ช่วง</span>
        <span className="text-ink-muted mx-1.5">·</span>
        ช่วงปัจจุบัน: {PHOTO_PHASE_LABEL[progress.currentPhase]}
      </p>
    </div>
  );
}
