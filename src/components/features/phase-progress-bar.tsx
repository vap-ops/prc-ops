// PhaseProgressBar (spec 54): three segments under the WP detail header
// — green = phase passed, blue = current phase, zinc = not reached —
// captioned with the done-count and the current phase label. Pure
// presentation over derivePhaseProgress; server-renderable.

import { derivePhaseProgress, PHASE_ORDER } from "@/lib/photos/phase-progress";
import type { PhotoPhase } from "@/lib/photos/phase-progress";
import { PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";

const SEGMENT_CLASS = {
  complete: "bg-green-600",
  current: "bg-blue-700",
  empty: "bg-zinc-200",
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
            className={`h-1.5 flex-1 rounded-full ${SEGMENT_CLASS[segment]}`}
          />
        ))}
      </div>
      <p className="text-sm text-zinc-700">
        ความคืบหน้ารูปถ่าย{" "}
        <span className="font-bold text-zinc-900">{progress.doneCount} จาก 3 ช่วง</span>
        <span className="mx-1.5 text-zinc-400">·</span>
        ช่วงปัจจุบัน: {PHOTO_PHASE_LABEL[progress.currentPhase]}
      </p>
    </div>
  );
}
