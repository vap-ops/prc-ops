# Feature Spec 03: SA Photo Upload UI

## Status

Draft — 2026-05-24

Docs-only — no schema, no code. This spec captures the locked design
for the site-admin photo upload UI so the build (planned as 2 PRs) is
mechanical. The schema half (tables + bucket) shipped in
[Feature spec 02](./02-photos-and-approvals.md) and the storage-bucket
unit; this spec is the first major user-facing surface that uses them.

## Goal

Replace the placeholder `/sa` landing with the real PWA photo-upload
flow: an SA picks a project, picks a work package, sees the current
Before / During / After photos, adds new photos (direct client →
Storage upload, append a `photo_logs` row through a server action),
and removes photos (append a tombstone row). When the first After
photo lands on a WP, the WP's status auto-transitions to
`pending_approval` so PMs can review.

Project managers and `super_admin` users can use the same flow (the
photo_logs INSERT policy and bucket policy both admit all three
privileged roles); the design and tone are SA-led because SAs are the
primary field users.

LIFF (LINE Front-end Framework) is deferred to v2 per locked v1 scope;
this is the regular PWA surface served at `/sa/*` from the same
Next.js app PMs use.

## Context & platform

- **Audience.** Site admins are field users on phones, often on
  patchy site Wi-Fi or mobile data. The UI is **mobile-first** — every
  screen designed for one-handed thumb reach; thumbnails sized for a
  phone viewport; no horizontal scroll; no tiny tap targets.
- **PWA surface.** Per the locked stack, `/sa/*` is the PWA-optimised
  path. The same Next.js app serves it; the PWA bits (manifest,
  service worker, install prompt) are out of scope here and ship in a
  later infra unit, but the routes are designed so the eventual PWA
  shell wraps them cleanly.
- **Access model.** Role-level per
  [ADR 0013](../decisions/0013-project-access-model.md). Every
  `site_admin`, `project_manager`, and `super_admin` sees every
  project. There is no project-membership filter in v1. SAs in
  practice work one project at a time but may glance at other sites'
  status during a visit — the project list view supports this.
- **Connectivity tolerance.** Uploads are per-photo with visible
  status (pending / uploading / done / failed) and **retryable**
  individually. A dropped connection mid-upload of one photo never
  blocks the rest of the session — the photo's row is added to
  `photo_logs` only after the bytes are in Storage, so a failed
  upload leaves zero database state to clean up (see "Upload
  sequencing" below). Full offline queueing with background sync is a
  v2 candidate, not v1.

## Locked design decisions

These were settled in a design session before drafting. They are not
open for re-litigation during implementation. If implementation
pressure suggests changing any of them, STOP and surface it — do not
improvise.

### Screen flow and surface

1. **Three-level drill-down.** `/sa` is a **project list**.
   Tapping a project opens its **work-package list**. Tapping a WP
   opens its **photo screen**. No deeper levels in v1. URLs follow
   the structure: `/sa` → `/sa/projects/{project_id}` →
   `/sa/projects/{project_id}/work-packages/{wp_id}` (final route
   shapes are PR-time decisions; what's locked is the three-level
   hierarchy and the persistence of project + WP in the URL).
2. **WP list is FLAT and text-filterable.** ~80 WPs per pilot project
   is the realistic v1 size. The list is one column, sorted by code,
   with a text filter input that narrows by code OR name. **No
   grouping by deliverable.** Deliverable-grouping was considered and
   **deferred to v2** (see "Deferred" below) — it requires a schema
   and CSV-import change, and the design-session lesson was to keep
   SA / PM vocabulary aligned for v1 rather than introduce a new
   layer.
3. **Photo screen shows three phase sections.** Before / During /
   After, each rendered as a thumbnail grid of the **current** photos
   for that phase plus an "add photo" control. Each thumbnail has a
   per-photo remove control. There is no "edit photo" — removal +
   addition is the only edit path (per
   [ADR 0015](../decisions/0015-photo-logs-tombstone-supersede.md)).

### Photo grain and current-state

4. **One `photo_logs` row = one photo.** Multiple photos per phase
   accumulate. The UI shows the current photos for the WP / phase
   exactly per ADR 0015's read pattern: the
   [ADR 0009](../decisions/0009-supersede-query-correction.md)
   anti-join PLUS `storage_path IS NOT NULL`:

   ```sql
   select pl.*
   from public.photo_logs pl
   where pl.work_package_id = $wp_id
     and pl.phase           = $phase
     and pl.storage_path is not null
     and not exists (
       select 1 from public.photo_logs newer
       where newer.superseded_by = pl.id
     );
   ```

   Tombstoned rows (`storage_path` NULL) and superseded rows (pointed
   at by a newer row) are excluded. The UI must never use a naive
   `WHERE superseded_by IS NULL` shortcut.

5. **Originals only — no watermark, no transformations.** Stored
   bytes are the unmodified file the SA took. Watermark rendering is
   a later unit (ADR 0003 governs); this UI displays the originals
   via signed URLs.

### Upload sequencing — **Option C: client UUID, upload-first, row-insert second**

6. **Path convention.**
   `{project_id}/{work_package_id}/{photo_log_id}.{ext}` inside the
   private `photos` Supabase Storage bucket created in the previous
   unit. UUIDs everywhere; no human-readable names. `ext` is one of
   `jpeg|png|webp|heic` (matches the bucket's `allowed_mime_types`).

7. **The photo's id is generated CLIENT-SIDE before upload.** The
   browser mints a UUID v4. That UUID is used for **both** the
   Storage object key and the `photo_logs.id` of the row that will
   reference it. This keeps the path and the row id identical without
   a round-trip — the row insert does not need to learn the id from
   anywhere.

8. **Upload first, row insert second.** Step order for "add a
   photo":
   1. Client generates `uuid` (v4).
   2. Client uploads bytes to Storage at
      `{project_id}/{wp_id}/{uuid}.{ext}` using its authenticated
      Supabase session. The bucket's INSERT policy
      (`photos uploads by sa/pm/super`) gates this — see the storage
      bucket unit.
   3. Only if step 2 succeeds, the client invokes the
      `addPhoto` server action with
      `{ workPackageId, phase, photoLogId: uuid, ext,
capturedAtClient? }`. The server action validates and INSERTs the
      `photo_logs` row (see "Server actions" below).

9. **Failure modes.**
   - **Upload fails** (network drop, bucket policy denial, file size
     / MIME rejection): no `photo_logs` row is created; the UI shows
     a per-photo error and a Retry button that re-attempts the
     upload with the SAME client-generated `uuid` (so a successful
     retry still ends up with the path and row id matching). On user
     abandon, no state to clean up.
   - **Upload succeeds, row insert fails** (server action rejects /
     network drop after upload): an **orphaned file** remains in
     Storage with no row pointing at it. This is **acceptable**.
     Orphaned objects are invisible to the application (every read
     path filters by `photo_logs.storage_path`), and the bucket
     already accumulates orphans from tombstoned photos (v2 cleanup
     concern). The UI surfaces a retry that re-invokes only the
     server action with the same uuid + path — succeeds on the
     second try the row matches the existing object, no re-upload
     needed.

10. **The KEY invariant**: this ordering never produces an orphaned
    `photo_logs` row. A row only exists if its object exists. The
    reverse (object without row) is acceptable in v1; the inverse
    (row without object) would pollute the anti-join current-state
    query and require tombstoning the broken row, which is wasted
    state.

### Server actions (writes go through the server)

11. **Photo INSERTs flow through a server action**, not a direct
    client `supabase.from('photo_logs').insert(...)`. The Storage
    upload is direct client → Storage (it must be — the bytes never
    pass through the Next server), but the row insert is server-side
    so it can validate. Server action: `addPhoto`.

        The action runs **under the user's session** (the RLS INSERT
        policy on `photo_logs` admits `site_admin`, `project_manager`,
        `super_admin` — the same set that may upload to the bucket; no
        elevated privilege is needed for the row insert itself). It
        validates:

        - `phase ∈ {'before','during','after'}` (the `photo_phase` enum
          will reject otherwise, but pre-validating gives a cleaner error
          surface);
        - the `work_package_id` exists and the caller may read it (RLS
          on `work_packages` already enforces this for the server-side
          `.select('id, project_id').eq('id', wpId)`);
        - the storage path the client used matches the expected
          `{project_id}/{wp_id}/{uuid}.{ext}` shape — derive
          `project_id` from the WP it just looked up, recompute the
          canonical path, and compare to the client-supplied path. If
          the client claims a path that doesn't match the WP it's
          inserting against, reject.

        Then inserts `photo_logs` with
        `id = uuid, work_package_id, phase, storage_path,

    uploaded_by = current user, captured_at_client = passed-through
    device time if provided`. `created_at`is the server`now()`.

12. **Photo REMOVALs also flow through a server action**:
    `removePhoto({ photoLogId })`. The action validates that the
    target row is a real photo (not a tombstone, not already
    superseded — guards against double-remove from a stale UI),
    then INSERTs a tombstone row per ADR 0015: `storage_path =
NULL, superseded_by = photoLogId, uploaded_by = current user`,
    same WP / phase as the target (carried for query locality per
    the locked tombstone shape in spec 02). The Storage object is
    LEFT in place — v1 keeps tombstoned objects; orphan cleanup is
    v2.

13. **Server actions are the single chokepoint for writes** to
    `photo_logs`. Application code does not write to `photo_logs`
    from anywhere else in v1. This keeps the validation rules in
    one place, makes the auto-transition logic (next section)
    addable in exactly one location, and aligns with the project's
    general "server actions for writes" pattern.

### Status transition (the deferred photo-driven WP transition)

14. **First After-phase photo flips the WP to `pending_approval`.**
    When `addPhoto` successfully inserts a row with
    `phase = 'after'`, it also updates the parent WP's status to
    `pending_approval` — but **only if** the WP's current status is
    one of `not_started`, `in_progress`, `on_hold`. If the WP is
    already at `pending_approval` or `complete`, the action makes no
    status change (no regression of an already-approved WP, no
    redundant write).

15. **OPEN IMPLEMENTATION QUESTION — must be resolved before
    PR 2 starts.** The `work_packages` table's UPDATE RLS policy
    admits only `project_manager` and `super_admin`. An
    SA-initiated `addPhoto` cannot update `work_packages.status`
    under the SA's own session. Three options for PR 2 to weigh,
    explicitly:

    a. **Service-role escalation for JUST the status update.** The
    `addPhoto` server action does the row insert under the user's
    session (validates RLS), then performs the WP status update
    using the admin client
    ([`src/lib/db/admin.ts`](../../src/lib/db/admin.ts)). Smallest
    surface; the escalation is one line in one server action;
    `work_packages` RLS unchanged. The cost: one extra DB connection
    per After-phase upload and a precedent of using the admin client
    inside a per-user action (currently the admin client is only
    used in auth callbacks).

    b. **Widen `work_packages` UPDATE RLS to include `site_admin`,
    scoped to the status column.** Postgres RLS gates rows, not
    columns, so this would broaden SA's UPDATE rights beyond
    "status only" without an additional CHECK constraint or a
    column-grant trick. Risky — SA could in principle UPDATE
    `name`, `description`, etc. Discard unless paired with a
    column-grant restriction that the build proves works.

    c. **Trigger-based transition on `photo_logs` INSERT.** A
    Postgres BEFORE/AFTER INSERT trigger on `photo_logs` checks
    `NEW.phase = 'after'` and updates `work_packages.status`
    accordingly. The trigger runs as table owner (typically with
    elevated privilege), so SA's session can fire it without
    needing UPDATE on `work_packages`. Moves the rule into the
    schema layer, which makes it impossible to bypass — but pulls
    a status-transition rule into the database and away from the
    server-actions chokepoint. Worth evaluating because spec 02
    already noted the `pending_approval` value exists "ready for
    the trigger/behavior" — the schema is set up for this
    option.

    **PR 2 must surface one of (a) / (b) / (c) (or a new
    proposal) and stop for operator decision before writing code.**
    The status-transition logic is one of the load-bearing pieces
    of this feature; do not improvise privilege escalation.

16. **No "submit for review" button.** Reviewability is **derived**
    from "After photos exist for this WP," exactly as feature spec
    02 locked. There is no `is_reviewable` column, no submission
    record. The PM approval UI (separate unit) reads from the
    current-state query against `photo_logs` filtered to
    `phase = 'after'` and treats any WP with at least one current
    After photo as reviewable.

### Viewing photos (private bucket → signed URLs)

17. **Server-minted short-lived signed URLs for thumbnails.** The
    `photos` bucket is private; client code cannot read objects
    directly. Provide a server-side helper that, given one or many
    `photo_logs` ids, verifies the caller may read (their role is
    in `site_admin / project_manager / super_admin` — the SELECT
    RLS already enforces this implicitly via the row lookup), then
    returns short-lived signed URLs for the corresponding objects.

18. **TTL is short.** 60–300 seconds. The signed URL only needs to
    live as long as the page that renders the thumbnail. Re-mint on
    navigation or refresh; do NOT cache signed URLs in localStorage
    or persist them anywhere. Shorter TTL minimises the value of a
    leaked URL.

19. **One round-trip per page render.** Batch: the photo screen
    queries `photo_logs` for the current photos of the WP, then
    calls the helper once with all the resulting ids and gets back
    a map of `{ photoLogId → signedUrl }`. Per-photo round-trips
    are forbidden — for ~30 photos per WP that's 30 unnecessary
    REST calls.

20. **Signed URLs are minted using the service role**
    (`src/lib/db/admin.ts`) inside the server-side helper.
    Service-role bypasses Storage RLS by design; the
    application-layer role check (the photo_logs SELECT under the
    user's session, which RLS gates) is what authorises the read.
    This is the design the storage-bucket unit's "no SELECT policy
    on storage.objects" decision was waiting on.

### Tombstone replacement semantics (recap from ADR 0015)

21. **Replace = remove + add. Two server actions, not one.** If an
    SA wants to swap a bad photo for a better one, the UI sequences
    `removePhoto` followed by `addPhoto`. The two calls are
    independent — there is no atomic-replacement variant in v1 (per
    ADR 0015). The UI may want to wrap both into one apparent
    operation (a "Replace" button that calls both in order) but
    must surface partial failure: if the remove succeeds but the
    add fails, the UI shows the old photo as removed and prompts
    to retry the upload. The user is not locked out of the
    half-completed state.

22. **Removal does NOT delete the Storage object.** The tombstone
    is a `photo_logs` row insert; the underlying file remains in
    the bucket. Application reads never see it (no row references
    it after tombstoning). v2 orphan cleanup handles disk usage.

## Build plan — 2 PRs

### PR 1 — navigation + read-only photo viewing

**Branch:** `feat/sa-upload-nav-and-read` (final name set at PR
time).

**Scope:**

- Replace [`src/app/sa/page.tsx`](../../src/app/sa/page.tsx) with the
  project list view. Pull projects via the SSR client; RLS already
  scopes to the user's role.
- Project detail route → flat, filterable WP list. Filter is
  client-side text on the already-loaded WP rows (no debounced
  server search — the ~80-row scale doesn't need it).
- WP detail route → photo screen showing the three phase sections,
  each rendering the **current** photos via the anti-join +
  `storage_path IS NOT NULL` query.
- **Signed-URL viewing helper** at `src/lib/photos/` (final name
  PR-time): server module that mints batch signed URLs against the
  `photos` bucket using the service role. TTL 60–300s. Used by the
  photo screen to render thumbnails.
- No upload / remove / status transition yet. The "add photo"
  control is either absent or disabled with a "coming in next PR"
  hint — PR-time judgment, lean towards absent so the screen
  doesn't suggest a button that doesn't work.
- Tests: at minimum a vitest unit test for the current-state query
  shape and the signed-URL helper's batch behaviour (mocked Storage
  client). Playwright is not required for PR 1 since the
  authenticated-path E2E is still deferred per the PR 4 LINE-auth
  notes.

**Verification at PR 1:**

- `pnpm build` shows the new SA routes.
- Manual smoke (operator, post-merge, on Vercel preview): log in as
  SA, see the project list; pick a project, see filterable WPs;
  pick a WP, see the photo screen (empty until photos exist).
  Manually INSERT a photo_logs row via SQL pointing at a manually
  uploaded test file in the bucket; confirm it shows up.

### PR 2 — upload + remove + status transition

**Branch:** `feat/sa-upload-write` (final name set at PR time).

**Prerequisite — RESOLVE FIRST.** The status-transition privilege
question (locked decision 15 above). PR 2 starts with a proposed
mechanism and **stops** for operator decision before writing the
transition code. Once a path is chosen, the rest is mechanical.

**Scope:**

- `addPhoto` server action — validates, runs direct client →
  Storage upload (the client side of this lives in the photo
  screen's "add photo" control), then inserts `photo_logs` under
  the user's session.
- `removePhoto` server action — validates and inserts a tombstone
  row per ADR 0015.
- Per-photo upload UI: progress / done / failed states; retryable
  on failure with the same client-generated UUID.
- Status auto-transition (per the resolved mechanism from
  decision 15) inside `addPhoto` when
  `phase = 'after'` AND the WP is currently
  `not_started | in_progress | on_hold`.
- Wire the photo screen's "add photo" and per-photo remove controls
  to the actions.
- Tests: vitest unit tests for the server actions (validation
  rules, including the path-matches-WP check); a pgTAP test (or
  extension of `09-photo-logs.test.sql`) that asserts a real-photo
  insert followed by a tombstone produces the right anti-join
  outcome (already covered in PR 1 of feature spec 02, but worth a
  recap here in case the action's path-derivation has its own
  test surface); if option (c) is chosen for status transition,
  add a pgTAP test that proves the trigger fires only on the
  first After photo and respects the
  not_started/in_progress/on_hold gate.

**Verification at PR 2:**

- `pnpm db:test` green.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
- Manual smoke (operator, on Vercel preview): upload one Before, one
  During, one After photo on a clean WP; confirm:
  - all three appear as thumbnails on the photo screen;
  - the WP's status flipped to `pending_approval` after the After
    upload (and not before);
  - remove the After photo; confirm it disappears from the screen;
  - confirm the `photo_logs` table now has 4 rows for that WP (3
    real + 1 tombstone), and the current-state anti-join returns
    2 (the Before and During originals, but not the tombstoned
    After);
  - confirm `work_packages.status` for that WP did **not**
    transition back from `pending_approval` after the After was
    removed (no regression; the rule is one-way for v1).

## Deferred / out of scope (documented)

These are explicitly NOT part of this spec and will land as their
own units:

- **Deliverable-grouping of work packages.** v2 candidate. Requires
  a `deliverables` table (or column) and a CSV-import update. The
  design-session decision was to keep SA / PM vocabulary aligned
  for v1 — both audiences see the same flat WP list. If grouping
  is needed later, the schema change is forward-compatible (add a
  nullable `deliverable_id` to `work_packages`, ship a UI that
  groups when populated).
- **Offline upload queue / background sync.** v2 candidate. The v1
  failure mode is per-photo retry against an online session. A
  full offline queue (uploads queued in IndexedDB, replayed when
  connectivity returns) would be a Service Worker + Background
  Sync API project of its own — useful for crews on poor sites, but
  not a v1 blocker.
- **Photo annotations, captions, ordering, EXIF extraction.**
  None of it in v1. `photo_logs` carries no metadata beyond what
  the schema already records (phase, paths, timestamps,
  uploader). The eventual PDF report doesn't need captions.
- **Watermark-on-demand rendering.** Separate later unit per
  ADR 0003. This UI displays **originals** via signed URL. The
  watermark renderer will sit in front of the same signed-URL
  helper as a transformation step when it ships.
- **PM approval UI.** The surface that produces `approvals` rows
  (per feature spec 02 PR 2). Separate unit. PM lands on `/pm` and
  works from there.
- **PDF report generation.** Filters on the latest
  `approvals.decision = 'approved'` per WP. Separate unit.
- **WP editing beyond status transition.** No name / description /
  metadata edits from the SA UI in v1.
- **Atomic photo replacement.** ADR 0015 explicitly defers this.
  v1 replacement = `removePhoto` + `addPhoto` as two appends, with
  the UI bundling the two calls into one "Replace" button.
- **Orphaned-object cleanup.** Tombstoned photos leave their
  Storage objects in place. A v2 job (scheduled function or
  manual sweep) walks objects whose `photo_logs` row is
  tombstoned and deletes them.

## Recommendation (not built here)

If the operator picks **option (c)** for decision 15 (trigger-based
status transition), the trigger plus the WP status-gate rule is
substantial enough to deserve its own short ADR — same pattern
ADR 0015 used for the tombstone variant. Options (a) and (b) are
small implementation choices that fit a PR description; (c) writes
schema-layer behaviour and is worth pinning. The build prompt for
PR 2 should explicitly flag "if (c) is chosen, write ADR 0016
alongside the migration."

## References

- [Feature spec 02](./02-photos-and-approvals.md) — locks the
  `photo_logs` + `approvals` schema this UI writes to, the
  tombstone-supersede shape, and the deferred-but-named units
  (Storage bucket, this UI unit, PM approval UI, watermark, PDF).
- [ADR 0013](../decisions/0013-project-access-model.md) —
  role-level access model the project and WP queries inherit.
- [ADR 0011](../decisions/0011-rls-role-helper.md) —
  `current_user_role()` helper; the only correct way to gate on
  role in RLS for tables this UI reads / writes.
- [ADR 0009](../decisions/0009-supersede-query-correction.md) —
  the anti-join current-state read pattern the photo screen runs.
- [ADR 0015](../decisions/0015-photo-logs-tombstone-supersede.md)
  — tombstone-supersede mechanism, well-formedness CHECK, the
  "replacement = two appends" rule, the partial index this UI's
  anti-join depends on.
- [ADR 0003](../decisions/0003-photos.md) — originals stored
  unmodified; watermark on demand. The watermark renderer is a
  later unit; this UI shows originals only.
- [`supabase/migrations/20260524020000_create_photo_logs.sql`](../../supabase/migrations/20260524020000_create_photo_logs.sql)
  — the table this UI writes to, including the
  `photo_logs_path_supersede_well_formed` CHECK the server
  actions must respect.
- [`supabase/migrations/20260524010000_create_work_packages.sql`](../../supabase/migrations/20260524010000_create_work_packages.sql)
  — the `work_package_status` enum (including the
  `pending_approval` value the auto-transition writes) and the
  current RLS that blocks SA from updating WPs (the source of
  decision 15's open question).
- [`supabase/migrations/20260524040000_create_photos_bucket.sql`](../../supabase/migrations/20260524040000_create_photos_bucket.sql)
  — the private `photos` bucket, the SA/PM/super INSERT policy,
  the 25 MiB / image-MIME limits the upload control must respect.
- [`src/app/sa/page.tsx`](../../src/app/sa/page.tsx) — the
  placeholder this feature replaces. The auth gate
  (`requireRole(["site_admin"])`) is the pattern PR 1 follows on
  the new routes (with PM and super_admin admitted on the same
  routes — PR-time decision on whether to share `/sa/*` or split
  into role-specific URLs; the spec leans share + admit, since the
  bucket and table policies admit all three roles).
- [`.claude/skills/supersede-pattern/SKILL.md`](../../.claude/skills/supersede-pattern/SKILL.md)
  — to be updated in PR 2 to teach the tombstone variant per ADR
  0015 (still deferred follow-up from the photo_logs unit; the
  upload UI is the first real consumer, so the skill update lands
  here rather than in the abstract).
