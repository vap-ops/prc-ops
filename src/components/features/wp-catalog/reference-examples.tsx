// Spec 389 U5 — the ตัวอย่างงาน strip (presentational). Starred reference
// photos of this WP's work-type across ALL projects (spec D2: the star hangs
// on the catalogue item, so a photo starred anywhere surfaces on every
// project's WP of that work-type). Read-only by design — the source-project
// chip names where the photo came from; it is never a link into that project
// (spec D3: the cross-project read is narrow by construction).

import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photos/photo-strip";

export interface ReferenceExampleRow {
  photoLogId: string;
  thumbUrl: string;
  fullUrl: string;
  projectName: string;
  note: string | null;
}

export function ReferenceExamples({ rows }: { rows: ReadonlyArray<ReferenceExampleRow> }) {
  if (rows.length === 0) return null;
  const fullUrls = rows.map((r) => r.fullUrl);
  const photoIds = rows.map((r) => r.photoLogId);
  return (
    <section aria-label="ตัวอย่างงาน">
      <h3 className="text-ink mb-1.5 text-base font-bold">
        ตัวอย่างงาน
        <span className="text-ink-secondary ml-1.5 text-sm font-normal">{rows.length} รูป</span>
      </h3>
      <p className="text-ink-secondary mb-2 text-sm">
        รูปที่ผู้อำนวยการโครงการปักดาวไว้เป็นตัวอย่างของงานประเภทนี้ จากทุกโครงการ
      </p>
      <PhotoStrip>
        {rows.map((r, i) => (
          <li key={r.photoLogId} className={PHOTO_STRIP_TILE}>
            <ZoomablePhoto
              src={r.thumbUrl}
              group={fullUrls}
              groupPhotoIds={photoIds}
              groupUploaderNames={rows.map(() => null)}
              groupIndex={i}
              photoId={r.photoLogId}
              uploaderName={null}
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
              <span className="block break-words">{r.projectName}</span>
              {r.note ? (
                <span className="block font-normal break-words opacity-90">{r.note}</span>
              ) : null}
            </span>
          </li>
        ))}
      </PhotoStrip>
    </section>
  );
}
