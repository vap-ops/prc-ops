// Spec 389 U5 — the ตัวอย่างงาน strip (presentational). Starred reference
// photos of this WP's work-type across ALL projects (spec D2: the star hangs
// on the catalogue item, so a photo starred anywhere surfaces on every
// project's WP of that work-type). Read-only by design — the source-project
// chip names where the photo came from; it is never a link into that project
// (spec D3: the cross-project read is narrow by construction).
//
// Deliberately NO photoId/groupPhotoIds on the lightbox: markup (spec 51) is
// scoped to the SOURCE project's members — a cross-project viewer would get a
// compose panel whose save can only 403 (the honest-copy class). null = markup
// off is the documented contract.
//
// The note renders when present; today no surface passes p_note to the star
// RPC, so notes arrive with a later star-note UI (deferred, spec §7).

import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photos/photo-strip";
import { REFERENCE_EXAMPLES_LABEL } from "@/lib/i18n/labels";

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
  return (
    <section aria-label={REFERENCE_EXAMPLES_LABEL}>
      <h3 className="text-ink mb-1.5 text-base font-bold">
        {REFERENCE_EXAMPLES_LABEL}
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
              fallbackSrc={r.fullUrl}
              group={fullUrls}
              groupIndex={i}
              uploaderName={null}
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
              <span className="block break-words">{r.projectName}</span>
              {r.note ? (
                <span className="line-clamp-2 block font-normal break-words opacity-90">
                  {r.note}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </PhotoStrip>
    </section>
  );
}
