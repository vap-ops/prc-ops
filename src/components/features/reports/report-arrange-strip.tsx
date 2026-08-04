"use client";

// Spec 394 D6 — arranging the selected photos WITHIN a work package. Lives on
// the page the PD is already on (the review WP screen shows exactly this WP's
// photos), so there is no second surface to find.
//
// ⭐ Deliberately NOT drag-and-drop. This is a gloved hand on a phone; a drag
// target that must be grabbed precisely and held is the wrong control for the
// audience, and `[touch-action]` on a horizontally scrolling strip is a known
// trap in this repo. Two large buttons per row are duller and they work.

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { reorderReportPhotos } from "@/lib/reports/report-selection-actions";

export interface ArrangeStripPhoto {
  photoId: string;
  /** Signed URL; absent when the mint failed — the row still arranges. */
  url?: string | undefined;
}

export function ReportArrangeStrip({
  workPackageId,
  photos,
}: {
  workPackageId: string;
  photos: ReadonlyArray<ArrangeStripPhoto>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Nothing selected ⇒ render NOTHING. Not an empty frame with disabled
  // arrows: a control that can never do anything is noise on a phone.
  if (photos.length === 0) return null;

  const move = (from: number, to: number) => {
    setError(null);
    const next = [...photos];
    const moved = next[from];
    if (!moved || to < 0 || to >= next.length) return;
    next.splice(from, 1);
    next.splice(to, 0, moved);
    startTransition(async () => {
      // The WHOLE list, never a delta — the server refuses anything that is
      // not exactly this WP's current set, so a stale client re-reads.
      const res = await reorderReportPhotos(
        workPackageId,
        next.map((p) => p.photoId),
      );
      if (!res.ok) setError(res.error ?? "จัดลำดับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-secondary text-sm">ลำดับรูปในรายงานลูกค้า</p>
      <ul className="flex flex-col gap-2">
        {photos.map((p, i) => (
          <li key={p.photoId} className="border-edge bg-card flex items-center gap-3 border p-2">
            <span className="text-ink-secondary w-6 shrink-0 text-center text-sm font-semibold">
              {i + 1}
            </span>
            {p.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL, no loader
              <img src={p.url} alt="" className="h-12 w-12 shrink-0 object-cover" />
            ) : (
              <span className="bg-sunk h-12 w-12 shrink-0" aria-hidden />
            )}
            <span className="flex-1" />
            {/* Each control names the POSITION: order is otherwise conveyed
                only visually, so a screen-reader user has no other cue. */}
            {i > 0 ? (
              <button
                type="button"
                aria-label={`เลื่อนขึ้น รูปที่ ${i + 1}`}
                disabled={pending}
                onClick={() => move(i, i - 1)}
                className="border-edge-strong rounded-control inline-flex h-11 w-11 shrink-0 items-center justify-center border"
              >
                <ChevronUp aria-hidden className="h-5 w-5" />
              </button>
            ) : null}
            {i < photos.length - 1 ? (
              <button
                type="button"
                aria-label={`เลื่อนลง รูปที่ ${i + 1}`}
                disabled={pending}
                onClick={() => move(i, i + 1)}
                className="border-edge-strong rounded-control inline-flex h-11 w-11 shrink-0 items-center justify-center border"
              >
                <ChevronDown aria-hidden className="h-5 w-5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-attn-edge text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
