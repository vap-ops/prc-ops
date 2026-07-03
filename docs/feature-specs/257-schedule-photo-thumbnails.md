# Spec 257 — Photo thumbnails in the schedule calendar

**Status:** in progress
**Depends on:** spec 256 (calendar views), ADR 0015 (photo exposure model), spec 65 (signed-URL minting)
**Schema:** none — code-only.

## Problem

Spec 256 shipped real calendar views, but วัน/สัปดาห์ only show photo _counts_
per WP. Operator wants to see the actual photos. This is also step 1 toward a
daily-report generator: the วัน view's per-WP photo evidence is the body of a
daily report.

## Step 0 — image transforms confirmed available

Probed the linked project's Storage REST API directly (`/storage/v1/object/sign/photos/<path>`
with `transform: {width:320, height:320, resize:"contain"}`): original 838KB →
transformed 14.5KB, HTTP 200, valid JPEG. Transforms are enabled on this
project's plan. No fallback path needed.

**Client-library constraint found:** `createSignedUrls` (bulk, used by the
existing `mintSignedUrls` core in `src/lib/storage/signed-urls.ts`) does NOT
accept a `transform` option — only the singular `createSignedUrl` does. So
thumbnail minting cannot reuse the existing bulk helper; it needs its own
`Promise.all` over singular calls, scoped per requested day (≤~70 photos,
same order of magnitude as the existing per-WP mint in `load-detail.ts`).

## Design

### Data (U1)

- `src/lib/photos/mint-thumbnails.ts` (new): `mintPhotoThumbnails(rows, {width, height})`
  → `Map<photoId, {thumbUrl, fullUrl}>`. Thumb via singular `createSignedUrl`
  with `transform`; full via the existing bulk `mintSignedUrls` (reused,
  unchanged). Both against the private `photos` bucket, 120s TTL (existing
  constant). Tombstones skipped (no `storage_path`).
- `src/app/projects/[projectId]/schedule/actions.ts` (new): server action
  `getSchedulePhotos(projectId, isoDates: string[])`. Re-reads `photo_logs`
  for the project under the caller's session (same `SCHEDULE_VIEW_ROLES` gate
  as the page — `requireRole` at the top of the action, not just the page),
  filters to current photos on the requested Bangkok dates via the existing
  `photo-evidence.ts` predicate (`currentPhotoRows` + `photoBangkokDate`,
  spec 256 U1 — no new predicate), then mints thumbnails. Returns
  `Record<isoDate, Record<wpId, Array<{photoId, thumbUrl, fullUrl}>>>`.
  Called from the client on view/date change — not baked into the page's
  initial server load, since signed URLs expire in 120s and the user may
  navigate dates minutes after page load.

### UI (U2)

- **วัน view** (`schedule-agenda.tsx`, `ScheduleDayView`): each มีงานจริง WP
  row grows a horizontal thumbnail strip below its link (all that day's
  photos for that WP, capped 60/day total across WPs — "+N ที่งาน" tail past
  the cap, linking to the WP's photo tab). Scroll row gets
  `[touch-action:pan-x_pinch-zoom]` per the existing scroll-row rule. Each
  thumbnail is `ZoomablePhoto` (`src/components/features/photos/photo-lightbox.tsx`,
  the existing trigger+lazy-overlay component used everywhere else in the
  app) — `src={thumbUrl}`, `group={fullUrls of that WP's strip}`,
  `groupIndex`, `photoId`; no new lightbox code, markup/comments come along
  for free (photos are still `photo_logs` rows under the caller's RLS).
- **สัปดาห์ view**: unchanged structurally, but each day-row's WP chip grows a
  small `ZoomablePhoto` thumbnail (first photo only, ~40px) inline — enough
  to recognize without the layout cost of a strip per day.
- **เดือน view**: unchanged (cell too small for a legible thumbnail).
- Fetch triggers on `ScheduleViews`' date/view change (debounced), loading
  skeletons while pending, silent no-op on mint failure (log, don't block the
  count-based view that already works).

### Out of scope (this spec)

Daily-report PDF generation — the วัน view becoming a report body is the
follow-up spec once this thumbnail plumbing exists; will need to reconcile
with spec 212 (SA daily report, in progress, blocked on 2 operator decisions)
rather than building two parallel report systems. Video/non-image evidence.
Bulk download.

## Units / PRs

- **U1** (PR 1): `mint-thumbnails.ts` + `getSchedulePhotos` action. TDD
  (pure parts; action shape smoke-tested with a stub client per the
  `load-schedule.test.ts` pattern).
- **U2** (PR 2): thumbnail strips in วัน/สัปดาห์, lightbox wiring, caps,
  skeletons. TDD (RTL).

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green per PR.
- [ ] mint-thumbnails tests: tombstone skip, empty input, thumb+full both
      returned per photo.
- [ ] Action test: role-gated (rejects non-SCHEDULE_VIEW_ROLES), filters to
      requested dates only, groups by WP.
- [ ] Component tests: strip renders after fetch, cap + "+N" overflow,
      lightbox opens on tap, skeleton during pending, silent degrade on
      mint error (count-only view still works).
- [ ] Live: a day with known photo count shows that many thumbnails (or the
      capped subset); thumbnail file size confirms real resize (not full-size
      images loaded at thumb display width).
