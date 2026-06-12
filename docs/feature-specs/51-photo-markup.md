# Spec 51 — Photo markup: drawing + comments on WP photos

**Status:** locked — 2026-06-12. Operator (feedback item 4, second
half): "Enable drawing and commenting feature on the image." The review
conversation ("the crack is HERE") has no home — PMs write WP-level
decision comments, but nothing points at a spot on a photo.

## Doctrine constraints (binding)

- **Photos are stored unmodified** (CLAUDE.md): markup is OVERLAY DATA
  rendered at view time — the original Storage object is never touched,
  no burned-in derivative is written.
- Markup rows are **append-only with tombstone removal** (ADR
  0004/0009/0015; supersede-pattern skill loaded). No editing in v1 —
  a markup is part of the conversation record; remove + redraw is the
  correction path.

## Scope

### A. DB — `photo_markups` (append-only, tombstone removal)

Migration mirrors the purchase_request_attachments shape:

- Columns: `id`, `photo_log_id` FK → photo_logs ON DELETE CASCADE,
  `strokes jsonb` (payload: array of `{points: [[x,y], …]}` normalized
  0..1), `comment text` (payload), `superseded_by uuid` (tombstone
  only), `created_by` FK users, `created_at`.
- CHECKs: tombstone shape `((strokes is null and comment is null)) =
(superseded_by is not null)` — a content row carries at least one
  payload and supersedes nothing (no atomic replacement, per skill);
  `comment <= 1000` chars; `jsonb_typeof(strokes) = 'array'`;
  same-parent tombstoning via composite FK `(superseded_by,
photo_log_id)` + identity unique, one tombstone per target via
  partial unique index (the ADR 0009 anti-join index).
- Append-only triple enforcement: revoke-all-first + column-scoped
  INSERT grant + SELECT; zero UPDATE/DELETE policies; BEFORE
  UPDATE/DELETE/TRUNCATE trigger raising P0001.
- RLS: SELECT role-gated to sa/pm/super (photo_logs mirror); INSERT
  role-gated + `created_by = auth.uid()` + parent photo readable +
  tombstones target own content rows of the same parent
  (table-qualified outer refs — name-capture hazard).
- `photo_markups_current` security_invoker view: content rows +
  anti-join (both filters).
- pgTAP file 31: catalog/posture, malformed-shape rejections, trigger
  P0001, role-sim matrix (sa add / visitor denied / foreign tombstone
  denied / own tombstone removes from view).

### B. Validation + actions

Pure validator `src/lib/photos/validate-markup.ts`:
`validatePhotoMarkup({strokes, comment})` — at least one payload
(`ต้องมีเส้นวาดหรือความเห็น`); comment trim/blank→null/≤1000
(`ความเห็นต้องไม่เกิน 1000 ตัวอักษร`); strokes: ≤50 strokes, each 2–500
points, every coordinate finite in [0,1] (`เส้นวาดไม่ถูกต้อง`), absent
→ null.

Server actions `src/app/photo-markups/actions.ts`:
`listPhotoMarkups` (current view + display names via the admin
name-lookup helper, isMine flag), `addPhotoMarkup` (validate → INSERT
under session RLS), `removePhotoMarkup` (read target under RLS →
tombstone INSERT; creator-only is RLS-enforced).

### C. Lightbox UI (ZoomablePhoto)

- New props: `photoId?: string`, `groupPhotoIds?:
ReadonlyArray<string | null>` (aligned with spec-50 `group`). Markup
  UI renders only when the current photo has an id — WP photo strips
  (SA + PM) thread ids; request attachments do NOT (purchase
  attachments are not photo_logs — recorded boundary).
- View mode: saved strokes render as an SVG overlay
  (`viewBox="0 0 1 1"`, polylines, red, non-scaling stroke) sized to
  the displayed image; comments list under the image (author Thai
  display name, Buddhist-era time, comment text), ลบ on own markups via
  ConfirmDialog → tombstone.
- Compose mode (วาดและความเห็น button): finger/pointer drawing on the
  overlay (normalized coords), ย้อนกลับ (undo last stroke), comment
  textarea, บันทึก/ยกเลิก with the standard save lifecycle. Swipe/arrow
  navigation gated while composing. Markups load per photo on open and
  on navigation (cached per id within the dialog session).

### Out of scope

Editing a markup (remove + redraw), markup in PDF reports, markup on
purchase-request attachments, colors/shapes/text-on-image tools,
LINE notifications for comments (seam), offline queueing of markups.

## Tests

- **Failing first:** `tests/unit/validate-photo-markup.test.ts` (shape
  matrix) and `tests/unit/photo-markup.test.tsx` (mocked actions:
  comments + strokes overlay render for the current photo, compose →
  save calls addPhotoMarkup with the comment, no markup UI without
  photoId).
- pgTAP file 31 per §A.

## Verification checklist

- [ ] New unit tests RED first, GREEN after; spec-50 lightbox tests
      pass unmodified (no-photoId contract).
- [ ] Migration dry-run = exactly one file; applied; `pnpm db:types`
      reconciles; `pnpm db:test` green.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + `pnpm build`.
- [ ] Original photo bytes untouched (no Storage writes anywhere in the
      diff); no UPDATE statements against photo_markups in src/.
- [ ] No `superseded_by IS NULL`-as-current-state reads in app code
      (view encodes the two-filter pattern).
