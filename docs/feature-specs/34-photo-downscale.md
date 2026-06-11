# Spec 34 — Client-side photo downscale (downscaled file IS the original)

**Status:** locked — 2026-06-11. Implements ADR 0036 (decision recorded
2026-06-11; policy: max 2000 px long edge, JPEG ~0.8, the uploaded file
is THE original, ADR 0003's invariant binds from upload).

## 0. Locked design

One shared browser helper prepares every photo before upload:
decode → if the long edge exceeds 2000 px, draw to canvas and re-encode
as JPEG 0.8 (orientation baked — browsers apply EXIF orientation at
decode per the `createImageBitmap` default) → otherwise the file passes
through untouched (EXIF intact, so orientation still renders
correctly). **Any decode/encode failure falls back to uploading the
original unchanged** — downscale is an optimization, never a gate; no
photo can become un-uploadable by this unit (HEIC on browsers without
HEIC decode keeps today's passthrough behavior; Safari re-encodes big
HEIC to JPEG, an upgrade).

## 1. Scope

**In:**

- `src/lib/photos/downscale.ts`:
  - `computeDownscaleTarget(width, height, maxEdge=2000)` — PURE
    (test-first): scaled dimensions + `needed` flag; no upscale; degenerate
    dimensions → not needed.
  - `preparePhotoForUpload(file)` — browser seam (createImageBitmap →
    canvas → toBlob('image/jpeg', 0.8)); returns
    `{ blob, ext, downscaled }` or `null` for non-photo MIME (callers'
    existing rejection path). Re-encoded → `ext: "jpeg"`,
    contentType `image/jpeg`; passthrough → original ext.
- `photoExtToMime(ext)` added to `src/lib/photos/path.ts` (inverse of
  `mimeToPhotoExt`; test-first).
- Integration in ALL THREE uploaders at the ext-derivation point
  (the prepared result replaces the raw `File` in state, so retries
  reuse the processed bytes — no re-decode on retry):
  - phase-uploader (WP photos)
  - PurchaseRequestAttachmentStager (reference images)
  - DeliveryPhotoUploader (delivery confirmations)
- Upload calls send `prepared.blob` with
  `contentType: photoExtToMime(prepared.ext)`.

**Out (recorded seams):** retroactive processing of stored photos
(never — append-only), Web Worker offload (volumes are single-file;
revisit with the offline queue), a quality/size UI, HEIC polyfill
decode, server-side verification of dimensions.

## 2. Behavior table (locked)

| Input                                 | Result                                              |
| ------------------------------------- | --------------------------------------------------- |
| JPEG/PNG/WebP, long edge > 2000       | JPEG 0.8 at ≤2000 px, ext `jpeg`, orientation baked |
| Any supported type, long edge ≤ 2000  | passthrough unchanged (EXIF intact)                 |
| HEIC, browser CAN decode (Safari)     | as above (big → JPEG; small → passthrough HEIC)     |
| HEIC, browser cannot decode           | passthrough unchanged (today's behavior)            |
| decode or encode throws / toBlob null | passthrough unchanged                               |
| non-photo MIME                        | `null` → caller's existing "unsupported" path       |

## 3. Verification checklist

- [ ] RED→GREEN: computeDownscaleTarget + photoExtToMime unit tests
      first (jsdom has no canvas/createImageBitmap — the browser seam
      is review + operator-phone verified, stager precedent).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; e2e 27 green.
- [ ] All three uploaders compile with the prepared-file flow; retry
      paths reuse prepared bytes (no raw-File reference survives in
      state).
- [ ] No DB/storage/policy diff (`supabase/` untouched).
- [ ] Operator phone pass (acceptance): upload a fresh camera photo on
      a test-safe WP → photo renders correctly oriented; Storage
      object size ~hundreds of KB, not MB (dashboard read-only check).
