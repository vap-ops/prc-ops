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
  /** Spec 391 D7 — a PD starred this one deliberately; the rest arrived
   *  automatically. Drives the ⭐ marker AND the subtitle wording below. */
  starred: boolean;
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
      {/* Spec 391 D8 — the old copy said "รูปที่ผู้อำนวยการโครงการปักดาวไว้"
          ("photos the project director starred"). Since 391 the set is mostly
          AUTOMATIC, so that sentence would credit a human for a machine's pick —
          the same lie D1 refuses to write into the table by backfilling stars.
          The wording now follows what is actually on screen: it only claims a
          PD chose them when a PD actually did.

          ⚠️ And it deliberately does NOT say ทำเสร็จแล้ว ("finished"). A draft did.
          The DERIVED half requires `status = 'complete'`, but the STARRED half
          does not — spec 389 U5 shipped "a star surfaces cross-project" with no
          status condition, and the ⭐ lives on /review, a pending_approval
          surface, so a starred photo is by definition not finished work at the
          time it is chosen. Claiming otherwise is the same lie class this copy
          exists to remove, relocated from WHO CHOSE it to WHAT STATE it is in.
          Adding the filter instead was tried and reverted (075902): it silently
          changed another spec's contract and red five of its assertions. */}
      <p className="text-ink-secondary mb-2 text-sm">
        {rows.every((r) => r.starred)
          ? "รูปที่ผู้อำนวยการโครงการปักดาวไว้เป็นตัวอย่างของงานประเภทนี้ จากทุกโครงการ"
          : "ตัวอย่างงานประเภทเดียวกัน จากทุกโครงการ — ⭐ คือรูปที่ผู้อำนวยการโครงการเลือกไว้เอง"}
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
            {/* D7 — the ⭐ marks a deliberate human pick. Without it, starring a
                photo that the derived arm was ALREADY showing is an action with
                no visible result, and the PD cannot tell their curation apart
                from the default. Decorative to a screen reader would be wrong,
                so it carries a label. */}
            {r.starred ? (
              <span
                className="pointer-events-none absolute top-1 right-1 text-[13px] leading-none drop-shadow"
                title="ผู้อำนวยการโครงการเลือกรูปนี้เป็นตัวอย่าง"
              >
                <span aria-hidden>⭐</span>
                <span className="sr-only">ผู้อำนวยการโครงการเลือกรูปนี้เป็นตัวอย่าง</span>
              </span>
            ) : null}
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
