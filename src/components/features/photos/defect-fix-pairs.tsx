// Spec 248 U3 — the defect→fix pairs, side by side. The PM approves rework
// where they can SEE that each defect photo got its same-angle answer
// (answers_photo_id); the reviewer verifies "same angle" here, where the
// decision happens. Server-safe presentational — ZoomablePhoto is the client
// leaf, same pattern as PhaseGallery.

import { ArrowRight } from "lucide-react";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";

export interface DefectFixPairVM {
  defectPhotoId: string;
  defectUrl: string | null;
  answers: ReadonlyArray<{ id: string; url: string | null }>;
}

function Tile({ url, alt }: { url: string | null; alt: string }) {
  return (
    <span className="border-edge bg-sunk relative block h-24 w-24 shrink-0 overflow-hidden rounded border">
      {url ? (
        <ZoomablePhoto src={url} />
      ) : (
        <span className="text-meta text-ink-secondary flex h-full w-full items-center justify-center">
          {alt}
        </span>
      )}
    </span>
  );
}

export function DefectFixPairs({
  heading,
  pairs,
}: {
  heading: string;
  pairs: ReadonlyArray<DefectFixPairVM>;
}) {
  if (pairs.length === 0) return null;
  return (
    <div>
      <h3 className="text-body text-ink mb-2 font-bold">{heading}</h3>
      <ul className="flex flex-col gap-2.5">
        {pairs.map((pair) => (
          <li
            key={pair.defectPhotoId}
            className="border-edge bg-card rounded-control flex items-center gap-3 border p-2.5"
          >
            <span className="flex flex-col items-center gap-1">
              <Tile url={pair.defectUrl} alt="ไม่พร้อม" />
              <span className="text-meta text-ink-secondary font-semibold">จุดบกพร่อง</span>
            </span>
            <ArrowRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
            {pair.answers.length > 0 ? (
              <span className="flex min-w-0 [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto">
                {pair.answers.map((a) => (
                  <span key={a.id} className="flex flex-col items-center gap-1">
                    <Tile url={a.url} alt="ไม่พร้อม" />
                    <span className="text-done-ink text-meta font-semibold">หลังแก้ไข</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-attn-ink text-sm font-semibold">ยังไม่มีรูปหลังแก้ไข</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
