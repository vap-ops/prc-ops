"use client";

// Tap-to-enlarge photo lightbox (spec 15 item D) — the TRIGGER half. This
// module renders on every thumbnail, so it stays deliberately thin: a
// button-wrapped thumbnail that fills its parent plus the open/close state.
// The enlarged view (markup canvas, comments, server-action calls — the
// heavy half) lives in photo-lightbox-overlay.tsx and is fetched through
// next/dynamic only when a photo is actually tapped (audit 2026-06 rank 6),
// so it never rides inside a page's initial chunk.
//
// 'use client' justification (CLAUDE.md): owns the open/close state, and
// next/dynamic({ ssr: false }) must be called from a Client Component.

import { useState } from "react";
import dynamic from "next/dynamic";

const PhotoLightboxOverlay = dynamic(
  () => import("./photo-lightbox-overlay").then((m) => m.PhotoLightboxOverlay),
  {
    ssr: false,
    // Instant acknowledgement while the overlay chunk streams in — the same
    // full-screen scrim the overlay itself paints (a beat, first open only).
    loading: () => <div aria-hidden className="fixed inset-0 z-50 bg-black/85" />,
  },
);

interface ZoomablePhotoProps {
  src: string;
  /** Quota-free full object URL to show if `src` fails to load (feedback
   *  87004dc1). The schedule strips mint their thumbnails through the
   *  Supabase image-transform API, which is capped at a monthly origin-image
   *  quota; once exceeded a not-yet-cached thumbnail 403s. Falling back to the
   *  plain object URL (which carries no transform, so no quota) keeps the
   *  photo visible. Omit on surfaces whose `src` is already a plain object URL
   *  (WP detail, portal, attachments) — they never 403 on transform quota. */
  fallbackSrc?: string;
  /** Ordered full-size URLs of the surrounding strip (spec 50). Groups
   *  never span sections — the caller passes one strip's URLs only. */
  group?: ReadonlyArray<string>;
  /** This photo's position inside `group`. */
  groupIndex?: number;
  /** photo_logs id — enables markup (spec 51). WP photo strips thread
   *  this; purchase-request attachments are NOT photo_logs and don't. */
  photoId?: string;
  /** photo_logs ids aligned with `group` (null = markup off for that
   *  member). */
  groupPhotoIds?: ReadonlyArray<string | null>;
  /** Uploader display name for the single (non-group) photo (feedback
   *  a6037564). Rendered as "ถ่ายโดย <name>" in the enlarged view. */
  uploaderName?: string | null;
  /** Uploader display names aligned with `group` (null when unresolved). */
  groupUploaderNames?: ReadonlyArray<string | null>;
  /** SA capture context: enables an in-detail delete affordance for the
   *  CURRENT photo (feedback 7c3347b3 — delete lives in the detail view,
   *  never on the small grid tile, so an upload can't be wiped by a
   *  mis-tap and feels permanent). Read-only surfaces (PM gallery, the
   *  recent strip) omit these props → no delete is shown. */
  canDelete?: boolean;
  /** Supersedes (tombstones) the given photo_logs id — wired to the
   *  capture engine's handleRemoveConfirmed. */
  onDeletePhoto?: (photoId: string) => void;
  /** photo_logs id currently being removed (parent optimistic state) →
   *  disables the button while the tombstone is in flight. */
  deletingPhotoId?: string | null;
}

export function ZoomablePhoto({
  src,
  fallbackSrc,
  group,
  groupIndex,
  photoId,
  groupPhotoIds,
  uploaderName,
  groupUploaderNames,
  canDelete,
  onDeletePhoto,
  deletingPhotoId,
}: ZoomablePhotoProps) {
  const [open, setOpen] = useState(false);
  // Thumbnail source with quota-403 fallback (feedback 87004dc1). Reset when
  // `src` changes so the spec-257 signed-URL refresh (~100s) re-tries the fresh
  // thumbnail and, critically, adopts the fresh fallback — the previous
  // fallback URL is a signed URL that expires in 120s, so pinning to it would
  // itself break after expiry. Reset happens during render (React's
  // "adjust state on prop change" pattern) rather than in an effect.
  const [thumbSrc, setThumbSrc] = useState(src);
  const [thumbSrcFor, setThumbSrcFor] = useState(src);
  if (thumbSrcFor !== src) {
    setThumbSrcFor(src);
    setThumbSrc(src);
  }

  const hasGroup = group !== undefined && group.length > 0;
  // Single-photo enlarged view: prefer the quota-free full URL when a caller
  // supplied one (feedback 87004dc1) — otherwise the week-strip lightbox would
  // open the same transform URL that 403'd in the thumbnail. Grouped callers
  // already pass `group` as full object URLs, so they're unaffected.
  const photos = hasGroup ? group : [fallbackSrc ?? src];
  // Align ids/names to `photos` for the overlay — the single-photo case
  // wraps the scalar props so the overlay indexes uniformly.
  const photoIds = hasGroup ? photos.map((_, i) => groupPhotoIds?.[i] ?? null) : [photoId ?? null];
  const names = hasGroup
    ? photos.map((_, i) => groupUploaderNames?.[i] ?? null)
    : [uploaderName ?? null];
  const initialIndex = groupIndex !== undefined && groupIndex >= 0 ? groupIndex : 0;

  return (
    <>
      {/* Spec 36: ring-inset — thumbnail wrappers use overflow-hidden,
          which clipped the (keyboard-only) focus ring entirely. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ดูรูปขยาย"
        className="focus-visible:ring-action block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {/* Plain <img> — signed Supabase URLs; same call as the existing
            thumbnails (next/image would need a remotePatterns entry). On a
            load failure (e.g. an image-transform quota 403 on the schedule
            strips) swap to the quota-free full object URL if one was given. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbSrc}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => {
            if (fallbackSrc && thumbSrc !== fallbackSrc) setThumbSrc(fallbackSrc);
          }}
        />
      </button>
      {open && (
        <PhotoLightboxOverlay
          photos={photos}
          initialIndex={initialIndex}
          photoIds={photoIds}
          uploaderNames={names}
          canDelete={canDelete}
          onDeletePhoto={onDeletePhoto}
          deletingPhotoId={deletingPhotoId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
