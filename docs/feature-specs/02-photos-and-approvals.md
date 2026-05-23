# Feature Spec 02: Photos and Approvals

## Status

Draft — 2026-05-24

Docs-only — no schema, no code, no ADR files yet. ADR 0015
(tombstone-supersede extension of ADR 0004 / ADR 0009) is written in
the PR 1 build unit, not here.

## Goal

Support the core v1 flow: site admins (and PMs) upload Before / During
/ After progress photos against a work package; PMs approve the work
package as a whole (the entire set of photos, not individual photos
and not individual phases); approved WPs feed the eventual PDF
report.

This spec covers two new tables:

- **`photo_logs`** — append-only progress photos, with a tombstone
  variant of the supersede pattern for removals.
- **`approvals`** — per-WP decision history; append-only event log.

These tables ship as two PRs, photo_logs first.

## Locked design decisions

These were settled in a design session before drafting. They are not
open for re-litigation during implementation. If implementation
pressure suggests changing any of them, STOP and surface it — do
not improvise.

### Grain and relationships

1. **One `photo_logs` row = one photo.** Photos accumulate; multiple
   per phase per work_package are expected.
2. **`photo_logs.work_package_id` → `work_packages.id`** (FK, NOT
   NULL). Photos belong to a WP. There is no per-phase entity and no
   per-photo grouping above the WP level.
3. **`phase` enum: `before` / `during` / `after`.** Multiple photos
   are allowed per phase. The enum value is mandatory on real photos
   (it is preserved on tombstones too — see "Tombstone-supersede"
   below).
4. **Approval is per-WORK-PACKAGE.** One PM decision covers all of
   the WP's photos across all phases. Approvals are NOT per-photo
   and NOT per-phase.
5. **A WP becomes "reviewable" once After photos exist.**
   Reviewability is **DERIVED at query/behavior time**, not stored —
   no `is_reviewable` column, no "submit for review" action, no
   submission record. The reviewable set is a query against current
   `photo_logs` rows filtered to `phase = 'after'`.

### Photo storage

6. **`photo_logs` stores only a REFERENCE** (`storage_path text`) to
   the unmodified file in Supabase Storage. The table never holds
   image bytes.
7. **The Supabase Storage bucket itself is a separate later unit.**
   This table just records the path. The bucket, the signed upload
   URLs, and the storage-side RLS belong to the next unit after
   these tables ship.
8. **Originals are stored unmodified.** Watermarks are rendered
   on-demand server-side at view/export time and are never baked
   into stored files. (This is an existing architecture rule from
   the project. Watermark rendering itself is a later unit; noted
   here for context — `photo_logs` carries no watermark state.)

### Append-only + tombstone-supersede (the key architectural decision)

9. **`photo_logs` is APPEND-ONLY**, triple-enforced exactly like
   `audit_log` (per [ADR 0004](../decisions/0004-audit.md)):
   1. **Privilege:** REVOKE UPDATE / DELETE on the `authenticated`
      and `anon` roles. INSERT and SELECT only.
   2. **RLS:** policies for INSERT and SELECT only. No UPDATE / no
      DELETE policy.
   3. **Trigger:** `BEFORE UPDATE OR DELETE` raises an exception.
      Catches the service_role / superuser path that bypasses the
      first two layers.
10. **Photos are ADDED by INSERT.** Nothing is ever hard-deleted or
    UPDATEd. There is no "edit a photo" operation.
11. **REMOVAL of a photo uses a TOMBSTONE: an append-only
    superseding row that marks the target photo removed, with NO
    replacement.** This **extends** the existing supersede pattern
    (ADR 0004 + [ADR 0009](../decisions/0009-supersede-query-correction.md))
    from "replacement" semantics to "removal" semantics.
    - **A tombstone row is distinguished by `storage_path IS NULL`.**
      A real photo always has a non-null `storage_path`; NULL is the
      removal marker.
    - The tombstone row's `superseded_by` points at the photo it
      removes — the same column the existing replacement pattern
      uses, with the same direction (newer → older).
    - **REPLACEMENT is not a special operation.** It is simply
      "tombstone the old photo + INSERT a new photo" — two
      appends, no atomic single-statement replacement. (If a future
      need calls for an atomic replacement variant, that ships as
      its own ADR; the v1 flow doesn't require it.)
12. **CURRENT photos for a WP / phase = the ADR 0009 anti-join,
    FILTERED to exclude tombstones.** A row is "current" iff no
    other row's `superseded_by` points at it AND its `storage_path`
    is not null. Sketch:

    ```sql
    SELECT pl.*
    FROM photo_logs pl
    WHERE pl.storage_path IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM photo_logs newer
        WHERE newer.superseded_by = pl.id
      );
    ```

    The first clause filters out tombstones (`storage_path IS
NULL`); the second clause filters out photos that have been
    tombstoned or replaced.

13. **ADR 0015 will document this divergence from the original
    "supersede = replacement" framing.** It is the first time the
    supersede pattern is used for removal as well as replacement,
    and the NULL-`storage_path` sentinel is a new convention that
    the skill at `.claude/skills/supersede-pattern` will need to be
    updated to teach. ADR 0015 is written **in the PR 1 build
    unit**, not in this spec.

### Timestamps

14. **`created_at` is SERVER-AUTHORITATIVE** (`timestamptz not null
default now()`). Treated as the canonical event time for
    ordering, audit, and the "most recent decision wins" rule on
    approvals.
15. **`captured_at_client` is UNTRUSTED.** Recorded so the eventual
    PDF report can display the device-reported capture time, but
    never used as the canonical timestamp for anything. EXIF / form
    timestamps may be wrong, time-shifted, or spoofed; the schema
    records them and the application labels them as "device
    reported" wherever displayed.

## Table specs

### `photo_logs`

| Column               | Type                      | Constraints                               | Notes                                                                                                   |
| -------------------- | ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`                    | PK, default `gen_random_uuid()`           |                                                                                                         |
| `work_package_id`    | `uuid`                    | NOT NULL, FK → `public.work_packages(id)` | ON DELETE behavior to be decided in the build PR. Likely `CASCADE` consistent with ADR 0013.            |
| `phase`              | `public.photo_phase` enum | NOT NULL                                  | New enum: `'before' \| 'during' \| 'after'`. Preserved on tombstones.                                   |
| `storage_path`       | `text`                    | NULLABLE                                  | NULL = tombstone (removal marker). Non-null = path of the original file in the Storage bucket.          |
| `superseded_by`      | `uuid`                    | NULLABLE, FK → `public.photo_logs(id)`    | Tombstone rows set this to the photo they remove. Indexed via partial index per ADR 0009.               |
| `uploaded_by`        | `uuid`                    | NOT NULL (likely FK → `public.users(id)`) | The user who uploaded the photo OR created the tombstone. Build PR decides the FK target / nullability. |
| `created_at`         | `timestamptz`             | NOT NULL, default `now()`                 | Server-authoritative.                                                                                   |
| `captured_at_client` | `timestamptz`             | NULLABLE                                  | Device-reported capture time. UNTRUSTED — stored only for display.                                      |

Indexes (final list locked in the build PR):

- Partial index on `superseded_by WHERE superseded_by IS NOT NULL`
  (per ADR 0009 — required for the anti-join read pattern).
- Index on `work_package_id` (standard FK lookup; every read is
  scoped to one WP).
- Likely a composite `(work_package_id, phase)` or
  `(work_package_id, phase, created_at)` index — the build PR
  measures and decides. Not part of this spec's lock.

Triple-enforcement (per ADR 0004 pattern):

- **Privilege:** `REVOKE ALL ON public.photo_logs FROM authenticated,
anon;` then `GRANT INSERT, SELECT ON public.photo_logs TO
authenticated;` (and to `anon` only if a public read surface ever
  needs it — currently no).
- **RLS:** policies below; no UPDATE or DELETE policies.
- **Trigger:** `BEFORE UPDATE OR DELETE` raises with SQLSTATE
  `P0001`, message `"photo_logs is append-only"` (or equivalent).
  Function shape identical to `audit_log_block_write` in the
  audit_log migration.

RLS policies — all via `public.current_user_role()` (ADR 0011), never
self-joining `public.users`:

- **INSERT** allowed when `current_user_role() in ('site_admin',
'project_manager', 'super_admin')`. All three privileged roles can
  upload photos AND can create tombstones. The privilege to remove a
  photo is the same as the privilege to add one — a deliberate v1
  simplification (no separate "moderator" role).
- **SELECT** allowed when `current_user_role() in ('site_admin',
'project_manager', 'super_admin')`. Same set as INSERT.
- **No UPDATE policy.** No DELETE policy. RLS denies both by default
  without a matching policy; the trigger catches the bypass paths.

Tombstone row shape (informational — there is no DB-level constraint
that distinguishes tombstones beyond the `storage_path IS NULL` /
`superseded_by IS NOT NULL` correlation):

| Field                | Tombstone value                                               |
| -------------------- | ------------------------------------------------------------- |
| `id`                 | new uuid                                                      |
| `work_package_id`    | same as the target photo's WP (carried for query-locality)    |
| `phase`              | same as the target photo's phase (carried for query-locality) |
| `storage_path`       | NULL                                                          |
| `superseded_by`      | the id of the photo being removed                             |
| `uploaded_by`        | the user who issued the removal                               |
| `created_at`         | server-set on insert                                          |
| `captured_at_client` | NULL                                                          |

The build PR may add a CHECK constraint forbidding
`storage_path IS NOT NULL AND superseded_by IS NOT NULL` (i.e. real
photos cannot themselves carry a `superseded_by`) — to be decided
during the build. Not part of this spec's lock.

### `approvals`

| Column            | Type                            | Constraints                               | Notes                                                                                                                  |
| ----------------- | ------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`              | `uuid`                          | PK, default `gen_random_uuid()`           |                                                                                                                        |
| `work_package_id` | `uuid`                          | NOT NULL, FK → `public.work_packages(id)` |                                                                                                                        |
| `decision`        | `public.approval_decision` enum | NOT NULL                                  | New enum: `'approved' \| 'rejected' \| 'needs_revision'`.                                                              |
| `comment`         | `text`                          | NULL allowed; CHECK described below       | Required when decision is `'rejected'` or `'needs_revision'`. Optional (NULL ok) when `'approved'`.                    |
| `decided_by`      | `uuid`                          | NOT NULL (likely FK → `public.users(id)`) | The PM (or super_admin) who recorded the decision. Build PR decides FK target / nullability.                           |
| `decided_at`      | `timestamptz`                   | NOT NULL, default `now()`                 | Server-authoritative. The WP's _current_ decision is the row with the maximum `decided_at` for that `work_package_id`. |

CHECK constraint (locked):

```sql
constraint approvals_comment_required_when_negative
  check (
    decision = 'approved'
    or (comment is not null and length(trim(comment)) > 0)
  )
```

Wording is illustrative — the build PR pins the exact identifier and
the trim-vs-non-empty subtlety. The semantic is locked: an empty or
whitespace-only `comment` on `'rejected'` / `'needs_revision'` must
be rejected by the constraint.

Triple-enforcement (same shape as `photo_logs` / `audit_log`):

- **Privilege:** REVOKE UPDATE / DELETE from `authenticated`,
  `anon`; GRANT INSERT, SELECT to `authenticated`.
- **RLS:** INSERT + SELECT policies only.
- **Trigger:** `BEFORE UPDATE OR DELETE` raises.

RLS policies — all via `current_user_role()`:

- **INSERT** allowed when `current_user_role() in
('project_manager', 'super_admin')`. **`site_admin` cannot
  approve.** This is the load-bearing access split between
  `photo_logs` (SA can upload) and `approvals` (SA cannot decide).
- **SELECT** allowed when `current_user_role() in ('site_admin',
'project_manager', 'super_admin')`. SA must be able to read the
  approval history so they can see `needs_revision` comments for
  WPs they uploaded to.
- **No UPDATE / no DELETE policy.**

Workflow this table must support (UI not in scope here, but the
data model has to admit it):

1. After photos exist on a WP → WP is reviewable (derived).
2. PM opens the WP → records a decision: `approved`, `rejected`, or
   `needs_revision`, with a comment (required for the latter two).
3. `needs_revision` → SA re-uploads clearer / additional photos to
   the same WP (more `photo_logs` rows) → PM re-reviews → records a
   NEW decision (another `approvals` row).
4. `rejected` → handled out-of-band (PM contacts the SA / project
   owner). No special status; the WP simply sits with `rejected` as
   its latest decision until a follow-up decision is recorded.
5. Eventually `approved` → that row's existence (the latest one for
   the WP) is what the PDF generator filters on.

The full **decision history** is preserved — every decision is a
new row; nothing is ever updated. "Current decision for WP X" is the
row with the maximum `decided_at` for `work_package_id = X`.

**v1 NOTE on separation of duties.** A `project_manager` who has
uploaded photos to a WP **CAN** still approve that same WP. Self-
approval is acceptable in v1 — the team is small and trusted, and
adding a separation-of-duties guard would require either a new
`uploaded_by` tracking column on approvals or an EXISTS subquery
against `photo_logs` in the INSERT policy. Both are out of v1
scope. Separation of duties is a documented **future concern**,
explicitly NOT built in v1.

## Build plan (two PRs, photo_logs first)

### PR 1 — `photo_logs` + ADR 0015

- **Branch:** `feat/photo-logs-table` (final name set when the PR is opened).
- **Migration:**
  - `create type public.photo_phase as enum ('before', 'during', 'after');`
  - `create table public.photo_logs (…)` per the column list above.
  - Partial index on `superseded_by WHERE superseded_by IS NOT NULL` (ADR 0009).
  - Index on `work_package_id`. Composite WP/phase index decided during the build.
  - Triple-enforcement: REVOKE + GRANT INSERT/SELECT; RLS enabled; INSERT + SELECT policies via `current_user_role()`; `BEFORE UPDATE OR DELETE` trigger that raises.
- **ADR 0015** at `docs/decisions/0015-photo-tombstone-supersede.md`:
  - Status: Accepted, amending ADR 0004 and ADR 0009.
  - Context: supersede was previously "replacement only." Photo removal needs the same append-only invariant without inventing a parallel deletion path.
  - Decision: extend the supersede pattern with a NULL-`storage_path` tombstone variant; current-state query is the ADR 0009 anti-join plus `storage_path IS NOT NULL`.
  - Consequences: positive (single mechanism for replace + remove); negative (NULL is overloaded as a sentinel — discuss the CHECK constraint trade-off); neutral (the supersede-pattern skill needs an update — done in the same PR).
  - Cross-link ADR 0004 (the foundational invariant), ADR 0009 (the read pattern this builds on), ADR 0013 (role-level access this table inherits).
- **pgTAP** at `supabase/tests/database/09-photo-logs.test.sql`, matching the patterns in `06-users-rls.test.sql` / `07-projects.test.sql` / `08-work-packages.test.sql`:
  - Enum `photo_phase` shape (3 labels).
  - Table shape + FK to `work_packages.id`.
  - RLS enabled; policy command set is exactly `INSERT` + `SELECT` (no UPDATE, no DELETE policy).
  - Triple-enforcement live tests:
    - INSERT under each role (SA / PM / super succeed; visitor denied 42501).
    - UPDATE attempt → trigger raises (P0001 or 42501 depending on the bypass layer hit).
    - DELETE attempt → 0 rows affected (RLS) and trigger raises on the bypass path.
  - **Tombstone + anti-join current-state behavior**:
    - Insert a real photo; current-state query returns it.
    - Insert a tombstone pointing at it; current-state query returns nothing for that WP/phase.
    - Insert a replacement photo (new real row); current-state query returns the replacement, not the tombstone, not the original.
    - Insert a replacement chain (A → B → C, where C supersedes B and B supersedes A); current-state returns C only.
  - `superseded_by` partial index exists.
  - `captured_at_client` round-trips through INSERT and is independent of `created_at`.
- **Types regen** via `pnpm db:types` — `photo_logs` Row / Insert / Update + `photo_phase` enum.
- **Skill update:** `.claude/skills/supersede-pattern` extended to teach the tombstone variant + NULL-`storage_path` convention, citing ADR 0015.
- **Verification:** `pnpm db:test` green; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

### PR 2 — `approvals`

- **Branch:** `feat/approvals-table` (final name set when the PR is opened).
- **Migration:**
  - `create type public.approval_decision as enum ('approved', 'rejected', 'needs_revision');`
  - `create table public.approvals (…)` per the column list above.
  - CHECK constraint per the locked semantic above.
  - Index on `work_package_id`. Composite `(work_package_id, decided_at desc)` index decided during the build (the "latest decision for a WP" query is the hot path).
  - Triple-enforcement: REVOKE + GRANT INSERT/SELECT; RLS enabled; INSERT (`pm + super`) + SELECT (`sa + pm + super`) policies via `current_user_role()`; `BEFORE UPDATE OR DELETE` trigger.
- **ADR (optional):** may get its own short ADR if the design exposes anything material; otherwise the rationale folds into the PR description. The CHECK-constraint contract and the SA-cannot-approve split are the two things worth surfacing in the ADR if it exists.
- **pgTAP** at `supabase/tests/database/10-approvals.test.sql`:
  - Enum `approval_decision` shape (3 labels).
  - Table shape + FK to `work_packages.id`.
  - RLS enabled; policy command set is exactly `INSERT` + `SELECT`.
  - CHECK constraint live tests:
    - `approved` with null comment → succeeds.
    - `approved` with comment → succeeds.
    - `rejected` with null comment → rejected (CHECK violation, SQLSTATE `23514`).
    - `rejected` with whitespace-only comment → rejected.
    - `rejected` with a real comment → succeeds.
    - same three cases for `needs_revision`.
  - RLS live tests:
    - PM INSERT succeeds; super_admin INSERT succeeds.
    - **SA INSERT denied (42501) — load-bearing.**
    - visitor INSERT denied.
    - SA SELECT succeeds (SA reads `needs_revision` comments for their WPs).
    - UPDATE / DELETE attempts blocked by the trigger.
- **Types regen** via `pnpm db:types` — `approvals` Row / Insert / Update + `approval_decision` enum.
- **Verification:** `pnpm db:test` green; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Deferred / out of scope (documented)

The following are explicitly **NOT** part of this spec and will land
as their own units:

- **Supabase Storage bucket + signed upload URLs.** The next unit
  after these tables ship. Includes the bucket policy, the
  upload-URL minting endpoint, and storage-side RLS.
- **Watermark-on-demand rendering.** A later unit (likely after the
  Storage bucket). Renders watermark server-side at view / export
  time; originals are never modified.
- **SA upload UI (the PWA surface).** The Before / During / After
  upload flow that produces `photo_logs` rows. Future unit.
- **`pending_approval` auto-transition on `work_packages`.** When
  the first After photo lands on a WP, `work_packages.status` will
  transition to `pending_approval` (or equivalent — to be decided in
  the upload-UI unit). Not built here. The WP table's status
  enum already includes `'pending_approval'` (see
  `supabase/migrations/20260524010000_create_work_packages.sql`) so
  the schema is ready; only the trigger/behavior is deferred.
- **PM approval UI.** The interface that produces `approvals` rows.
  Future unit.
- **PDF generation.** The report unit that filters on the latest
  `approvals.decision = 'approved'` per WP.
- **Separation-of-duties guard on approvals.** Documented above as
  a v1-accepted gap (a PM who uploaded photos to a WP can still
  approve that WP). Lifting the gap is a future concern, not built
  here.
- **Photo tagging, geolocation, AI / vision labels, EXIF round-trip,
  thumbnail metadata, or any other rich-photo metadata.** None of
  it ships in v1. `photo_logs` carries only the minimum needed for
  the report — storage_path, phase, WP, timestamps, uploader.

## References

- [ADR 0004](../decisions/0004-audit.md) — Audit trail and the
  foundational append-only + supersede pattern (this spec's
  `photo_logs` extends both layers).
- [ADR 0009](../decisions/0009-supersede-query-correction.md) —
  Current-state read pattern (the anti-join the tombstone-supersede
  filter builds on).
- [ADR 0011](../decisions/0011-rls-role-helper.md) —
  `current_user_role()` helper (mandatory primitive for every
  policy this spec specifies; no self-joins).
- [ADR 0013](../decisions/0013-project-access-model.md) — Role-level
  access for domain tables (the model `photo_logs` and `approvals`
  inherit).
- `supabase/migrations/20260524010000_create_work_packages.sql` —
  the `work_packages` table both new tables FK against; also the
  source of the `'pending_approval'` enum value used by the
  deferred status-transition unit.
- `.claude/skills/supersede-pattern` — the skill that teaches the
  supersede pattern. To be updated in PR 1 to cover the tombstone
  extension.
