// Spec 171 — the read-only phase photo gallery, extracted from the /review WP
// screen so the procurement WP view (read-only) can reuse it. Behaviour-preserving:
// the markup is exactly the PM-side timeline row (status disc + bold label +
// count, rail-indented body with the last-updated line and the filmstrip, no add
// tile). The capture-side surface stays in PhotoCaptureZone (site-staff only).

import { Check } from "lucide-react";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photos/photo-strip";
import { latestCreatedAt } from "@/lib/photos/phases";
import type { PhotoLogRow } from "@/lib/photos/current-photos";
import { formatThaiTime } from "@/lib/i18n/labels";

interface PhaseGalleryProps {
  label: string;
  photos: ReadonlyArray<PhotoLogRow>;
  signedUrls: ReadonlyMap<string, string>;
  /** uploaded_by → display name (feedback a6037564). Shown as "ถ่ายโดย
   *  <name>" in the lightbox; missing ids render no attribution line. */
  uploaderNames: ReadonlyMap<string, string>;
}

export function PhaseGallery({ label, photos, signedUrls, uploaderNames }: PhaseGalleryProps) {
  const hasPhotos = photos.length > 0;
  const latest = latestCreatedAt(photos);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3">
        {hasPhotos ? (
          <span className="bg-done inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white">
            <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : (
          <span
            aria-hidden
            className="border-edge-strong bg-card h-7 w-7 shrink-0 rounded-full border-2"
          />
        )}
        <h3 className="text-ink text-base font-bold">
          {label}
          {hasPhotos ? (
            /* Spec 49: the strip hides its tail — announce the total. */
            <span className="text-ink-secondary ml-1.5 text-sm font-normal">
              {photos.length} รูป
            </span>
          ) : null}
        </h3>
      </div>
      <div
        className={`ml-[13px] flex flex-col gap-2 border-l-2 pb-1 pl-5 ${
          hasPhotos ? "border-done" : "border-edge"
        }`}
      >
        <p className="text-ink-secondary text-sm">
          {latest ? `อัปเดตล่าสุด ${formatThaiTime(latest)}` : "ยังไม่มีรูป"}
        </p>
        {hasPhotos ? (
          /* Spec 49: filmstrip — page height stays constant per phase.
             Spec 50: the phase's loaded photos form one lightbox group. */
          <PhotoStrip>
            {(() => {
              const loaded = photos.flatMap((p) => {
                const u = signedUrls.get(p.id);
                return u
                  ? [{ id: p.id, url: u, uploaderName: uploaderNames.get(p.uploaded_by) ?? null }]
                  : [];
              });
              const loadedUrls = loaded.map((l) => l.url);
              /* Spec 51: ids aligned with urls — markup follows navigation. */
              const loadedPhotoIds = loaded.map((l) => l.id);
              /* Feedback a6037564: names aligned with urls — same as ids. */
              const loadedUploaderNames = loaded.map((l) => l.uploaderName);
              let loadedIndex = 0;
              return photos.map((p) => {
                const url = signedUrls.get(p.id);
                const groupIndex = url ? loadedIndex++ : 0;
                const uploaderName = uploaderNames.get(p.uploaded_by) ?? null;
                return (
                  <li key={p.id} className={PHOTO_STRIP_TILE}>
                    {url ? (
                      <ZoomablePhoto
                        src={url}
                        group={loadedUrls}
                        groupPhotoIds={loadedPhotoIds}
                        groupUploaderNames={loadedUploaderNames}
                        groupIndex={groupIndex}
                        photoId={p.id}
                        uploaderName={uploaderName}
                      />
                    ) : (
                      <div className="text-ink-secondary flex h-full w-full items-center justify-center text-xs">
                        ไม่พร้อมแสดง
                      </div>
                    )}
                    {/* Spec 54: capture-time overlay (mockup tiles). Feedback
                        a6037564: the uploader's name rides below the time so you
                        see WHO uploaded at a glance, not only in the lightbox.
                        break-words (not truncate) — Thai clips mid-word. */}
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
                      <span className="block">
                        {formatThaiTime(p.captured_at_client ?? p.created_at)}
                      </span>
                      {uploaderName ? (
                        <span className="block font-normal break-words opacity-90">
                          {uploaderName}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              });
            })()}
          </PhotoStrip>
        ) : null}
      </div>
    </div>
  );
}
