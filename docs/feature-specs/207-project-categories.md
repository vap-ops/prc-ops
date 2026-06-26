# 207 — Project work-categories + construction-drawing access (หมวดงาน + แบบก่อสร้าง)

STATUS: APPROVED — operator 2026-06-26. Building along U1→U6 (one unit per session).
Open decision #2 RESOLVED → master drawings are INTERNAL-ONLY (subcontractors never see
the master; U6 drops the `OR d.category_id IS NULL` arm; no per-drawing opt-in in v1).

Status: DRAFT (authored 2026-06-26, not started). Next number 207 verified against
`docs/feature-specs/` (highest existing = 206-wht-certificate-recording-ui.md).
Relates: feedback **1a556584** ("Project has categories"); ADR 0016 (deliverables as a
relational grouping table, the per-project FK precedent); ADR 0055 dec.2 (category as an
operator-extensible lookup TABLE, not an enum — `equipment_categories`); ADR 0056
(project-membership visibility cascade, `can_see_project`/`can_see_wp`); ADR 0058
(`project_director` see-all via single helper edit); ADR 0011/0013 (membership is
display/accountability, never an access gate — but DEFINER helper arms layer on top);
ADR 0051 §5 (portal reads use the RLS session, never the admin client); ADR 0062
(contractor firm vs DC worker portal identity). Needs a NEW ADR for the drawings domain
(append-only document store + per-project category taxonomy + subcontractor read arm).

---

## Why

Operator feedback **1a556584**: _"Every project has work-categories that each require
different drawings. There is a project-level MASTER drawing plus per-category drawings.
Categories relate to work packages. When a subcontractor is assigned to a WP, that
subcontractor must be able to see the drawings for that WP's category."_

Today the app has **no work-category** concept on a work package and **no drawing**
domain at all:

- The only WP grouping is `work_packages.deliverable_id` (งวดงาน, billing milestones,
  ADR 0016) — a different axis (customer-recognizable billing units, D01–D30), not a
  trade/scope category. `project_type` is the closest "category" field but it is a fixed
  GLOBAL enum on the **project**, shared across all projects.
- "drawing" in the codebase means `photo_markups` (spec 51 — canvas markup drawn on top
  of a progress photo). There is **no** stored design/blueprint document. `deliverables`
  holds only `id/project_id/code/name/sort_order` — no file column; it was never a file
  home.
- The subcontractor portal (`/portal`) lets a bound firm read only its own
  profile/payments/stock-issues/crew. There is no project-document surface.

This spec adds three additive concerns, all flowing from one feedback item:

1. **A per-project, operator-defined work-category taxonomy** (`project_categories`).
2. **Exactly one category per WP** — a single nullable FK on `work_packages`.
3. **A construction-drawing document store** (`project_drawings`) holding a project
   MASTER drawing plus per-category drawings, with a subcontractor able to read the
   drawings for the category of the WP its firm is assigned to.

### LOCKED product decision (operator, this session)

**A work package belongs to EXACTLY ONE project work-category.** A WP cannot span
multiple categories; the rare real-world exception is handled by a manual/temporary
workaround, **NOT modeled in the data**. Therefore one-category-per-WP is a single
nullable FK/column on `work_packages` — **never a join table**. This lands as the exact
`deliverable_id` precedent: `category_id uuid NULL references project_categories(id)
ON DELETE SET NULL`, written only through a role-and-membership-gated DEFINER RPC that
clones `set_work_package_deliverable`.

### Decisions baked into this spec (would be ADR-recorded)

- **Categories = per-project TABLE, not an enum.** Two independent disqualifiers for an
  enum: (a) an enum is global/shared across all projects, but the requirement is that
  each project has its OWN set; (b) operators add categories at runtime, and
  `ALTER TYPE ... ADD VALUE` needs an ADR + its own migration each time. ADR 0055 dec.2
  already ruled exactly this tradeoff for `equipment_categories`. The category's
  operator-authored Thai `name` column **IS** its label — no `labels.ts` enum `Record`.
- **`project_categories` is per-project-scoped** like `supply_plans`/`work_packages`:
  `project_id uuid NOT NULL references projects(id) ON DELETE CASCADE`, RLS read gated by
  `can_see_project(project_id)`, **no** direct table write grant — writes go through
  DEFINER RPCs (chosen over `equipment_categories`-style direct RLS writes because
  categories need the same-project + `can_see_project` gate that firm-wide
  `equipment_categories` does not).
- **Category is a CLASSIFICATION attribute, not a visibility scope.** Drawings carry
  `project_id` and are PROJECT-bound; the visibility hop stays `can_see_project`. The
  category is a filter column. The membership boundary is never bypassed by an inline
  role check, and `WP_DETAIL_ROLES` is never widened.
- **ONE `project_drawings` table** holds both the MASTER (`category_id IS NULL`) and
  per-category (`category_id` set) drawings. A NULL-vs-set discriminator is
  self-describing, needs no `drawing_scope` enum (no `ALTER TYPE` migration, no
  `labels.ts` Record), and a single `project_id` FK means ONE `can_see_project` hop
  covers both — no second table/view/helper/trigger.
- **`project_drawings` is append-only + supersede** (the
  `purchase_request_attachments` doctrine): logical edit = a new row pointing at the
  target via `superseded_by`; logical removal = a tombstone row (NULL `storage_path` +
  `superseded_by` set). Triple-enforced (revoked UPDATE/DELETE + no UPDATE/DELETE policy
  - `BEFORE UPDATE/DELETE/TRUNCATE` `block_write` trigger raising `P0001`); current state
    via a `security_invoker` `_current` anti-join view. **Never UPDATE the target row.**
- **Drawings are a NEW private Storage bucket** (`project-drawings`, `public=false`),
  PDF + image, 50 MiB ceiling. Reads via service-role-minted signed URLs
  (`mintSignedUrls`) for internal staff and via RLS-session signed URLs for the portal —
  never the admin client for external callers (ADR 0051 §5).
- **No new global enum. No change to any existing enum. Strictly additive.** New tables,
  one new nullable column, one new bucket (`on conflict do nothing`), new RPCs, new
  policies. No `DROP`, no destructive `ALTER`, no enum mutation.

---

## Data model (additive migrations only)

Four additive objects, zero enum, zero destructive change.

### 1. `public.project_categories` (NEW table — per-project work-category taxonomy)

Models `equipment_categories` (table-not-enum, ADR 0055 dec.2) wedded to the
`supply_plans`/`deliverables` per-project scoping.

| column       | type                                 | notes                                                                    |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------ |
| `id`         | `uuid` PK                            | `default gen_random_uuid()`                                              |
| `project_id` | `uuid NOT NULL`                      | `references projects(id) ON DELETE CASCADE`                              |
| `code`       | `text NOT NULL`                      | unique per project                                                       |
| `name`       | `text NOT NULL`                      | operator-authored Thai; **the name IS the label**                        |
| `sort_order` | `integer NOT NULL`                   | display ordering, like `deliverables.sort_order`                         |
| `is_active`  | `boolean NOT NULL default true`      | deactivate-not-delete (`catalog_items.is_active`)                        |
| `created_by` | `uuid NOT NULL`                      | `references users(id)`                                                   |
| `created_at` | `timestamptz NOT NULL default now()` |                                                                          |
| `updated_at` | `timestamptz NOT NULL default now()` | via the **existing** `public.set_updated_at()` trigger (do NOT redefine) |

Constraints / indexes:

- `unique(project_id, code)`
- `check (length(trim(name)) > 0)` (name nonblank)
- `check (length(name) <= 120)` (name cap)
- `project_categories_project_id_idx` on `(project_id)`
- **No DELETE** grant or policy (masters-no-delete convention; deactivate via
  `is_active`).

### 2. `public.work_packages.category_id` (NEW nullable FK — the locked one-category-per-WP)

```sql
alter table public.work_packages
  add column category_id uuid null references public.project_categories(id) on delete set null;
create index work_packages_category_id_idx on public.work_packages (category_id);
```

THE locked one-category-per-WP decision as a single nullable FK — the `deliverable_id`
precedent EXACTLY (nullable, `ON DELETE SET NULL`, indexed), **never a join table**. It
rides the existing `work_packages` SELECT grant (no new column grant). NULL = WP not yet
categorised.

### 3. `public.project_drawings` (NEW append-only table — MASTER + per-category drawings)

| column          | type                                 | notes                                                                                                                                |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`            | `uuid` PK                            | `default gen_random_uuid()`                                                                                                          |
| `project_id`    | `uuid NOT NULL`                      | `references projects(id) ON DELETE CASCADE` — **THE visibility-scope FK**, always set, denormalized onto category drawings too       |
| `category_id`   | `uuid NULL`                          | `references project_categories(id)` (see ON DELETE note below). **NULL == project MASTER**, non-null == that category's drawing      |
| `title`         | `text NOT NULL`                      | `check (length(trim(title)) > 0 and length(title) <= 200)`                                                                           |
| `revision`      | `text NULL`                          | free-form real-world rev label (e.g. 'Rev C'); `check (revision is null or length(revision) <= 40)`. **NOT** the supersede mechanism |
| `storage_path`  | `text NULL`                          | NULL **only** on tombstones                                                                                                          |
| `superseded_by` | `uuid NULL`                          | points at the row this one supersedes (carried on the NEW row — see below)                                                           |
| `created_by`    | `uuid NOT NULL`                      | `references users(id)`                                                                                                               |
| `created_at`    | `timestamptz NOT NULL default now()` | append-only audit row — NOT NULL + default, matching `purchase_request_attachments`                                                  |

CHECK shapes (the `pra` precedent):

- tombstone: `superseded_by IS NOT NULL ⇒ storage_path IS NULL`
- content: `superseded_by IS NULL ⇒ storage_path IS NOT NULL AND length(trim(storage_path)) > 0`
  - (express as one `check`: `(superseded_by is not null and storage_path is null) or (superseded_by is null and storage_path is not null and length(trim(storage_path)) > 0)`)
- `category_id`-set ⇒ same-project is enforced in the write RPC (`22023`), NOT a
  cross-table CHECK.

Composite identity + supersede integrity:

- `unique(id, project_id)` (composite identity)
- `foreign key (superseded_by, project_id) references project_drawings(id, project_id)`
  so a tombstone/replacement can't cross projects.
- partial unique index `on (superseded_by) where superseded_by is not null` (one
  tombstone/replacement per target).
- index `on (project_id)`; partial index `on (category_id) where category_id is not null`.

**`category_id` ON DELETE:** `project_categories` has NO delete (deactivate-not-delete),
so a delete can never fire — the FK action is structurally moot. Use a plain FK (no
`ON DELETE RESTRICT`) to avoid a misleading "guards a delete that can never happen"
clause; **document in the migration comment** that category deletion is structurally
impossible. (Resolves immutability-review minor: the `ON DELETE RESTRICT`-on-an-
undeletable-parent contradiction.)

### 4. `public.project_drawings_current` (NEW `security_invoker` view)

Non-tombstone, non-superseded rows via anti-join:

```sql
create view public.project_drawings_current
  with (security_invoker = true) as
  select pd.*
  from public.project_drawings pd
  where pd.storage_path is not null
    and not exists (
      select 1 from public.project_drawings t where t.superseded_by = pd.id
    );
```

`security_invoker` so base-table RLS applies to internal staff AND the bound
subcontractor identically. **Anti-join visibility caveat (immutability-review major):**
because the anti-join runs under the querying role's RLS, the `_current` guarantee is
only absolute if a role that can see a content row can ALSO see its
tombstone/superseding row. U6's `can_subcon_see_drawing` MUST therefore return the same
visibility for a content row and its supersede/tombstone within the firm's own category
(see U6). The portal loader (`own-drawings.ts`) reads through this view on the RLS
session; if the supersede-chain visibility proof is hard to pin, the loader filters in
SQL instead of relying on the shared view's anti-join under a foreign RLS posture (U6
decides; pgTAP pins it either way).

> No relation maps a WP directly to a drawing. Drawings relate to a WP **through the
> category**: `work_packages.category_id → project_categories.id ← project_drawings.category_id`.
> The subcontractor query is then a clean two-hop, never a WP↔drawing link.

---

## Storage / drawings model

ONE new PRIVATE bucket `project-drawings` (`public=false`), inserted into
`storage.buckets` via migration (`on conflict do nothing`). Add a
`PROJECT_DRAWINGS_BUCKET` id constant to `src/lib/storage/buckets.ts`.

**Explicit per-bucket mime/size decision** (no existing bucket mixes PDF + image:
`reports` is PDF-only 50 MiB, image buckets are 25 MiB image-only):

- `allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic']`
  (PDF first-class for real construction drawings + images for scanned/photographed sheets).
- `file_size_limit = 52428800` (50 MiB — drawings exceed the photo ceiling; the
  `reports` ceiling).
- **CAD/DWG/DXF deliberately OUT of v1** (no safe inline browser preview/thumbnail) —
  recorded in Out-of-scope.

**Path** (app-built helper `buildProjectDrawingPath` in `src/lib/drawings/path.ts`,
validated by the storage INSERT policy, NEVER DB-enforced):

- master = `{project_id}/master/{drawing_id}.{ext}`
- category = `{project_id}/category/{category_id}/{drawing_id}.{ext}`

**Upload flow** (the `catalog-image-control` / `use-phase-capture` client pattern):
`crypto.randomUUID()` drawing_id → **NO downscale** (deliberate divergence — drawings
stay full-resolution, unlike `preparePhotoForUpload`; validate mime/size client-side) →
browser anon client `supabase.storage.from(PROJECT_DRAWINGS_BUCKET).upload(path, file,
{contentType, upsert:false})` → then the DEFINER `record_project_drawing` RPC records the
path.

### `storage.objects` policies (`objects.name` ALWAYS qualified — name-capture hazard)

- **INSERT** (to authenticated):
  `bucket_id = 'project-drawings'`
  `AND (select public.current_user_role()) in ('project_manager','super_admin','project_director')`
  `AND array_length(storage.foldername(objects.name), 1) between 2 and 3`
  `AND (storage.foldername(objects.name))[2] in ('master','category')`
  **AND** `(select public.can_see_project( (storage.foldername(objects.name))[1]::uuid ))`
  — so the byte upload is **membership-gated**, not role-only (resolves rls-review major:
  membership-blind upload). Guard the `[1]::uuid` cast against malformed paths so a
  non-uuid segment yields **deny, not error** (wrap the cast in a DEFINER helper that
  returns false on a bad cast, OR a regex `~` check before the cast).
- **NO broad SELECT policy.** Internal reads use service-role signed URLs.
- The ONLY storage SELECT policy added (U6, the `contact-docs` portal exception) is for
  the bound subcontractor — see U6; it is backed by a DEFINER helper, NOT a raw
  `work_packages` join (resolves rls-review + immutability-review blockers).

### Reads — reuse `mintSignedUrls`, do NOT re-clone

- Internal staff: `mintSignedUrls(PROJECT_DRAWINGS_BUCKET, rows)` from
  `src/lib/storage/signed-urls.ts` (service-role admin, 120 s TTL) in **server-only**
  loaders over `project_drawings_current`.
- Subcontractor portal: `createSignedUrls` on the **RLS session**
  (`src/lib/portal/own-documents.ts` precedent → new `src/lib/portal/own-drawings.ts`),
  **NEVER** the admin client (ADR 0051 §5).

---

## RLS + SECURITY DEFINER gating

**Core principle:** category is a classification attribute, NOT a visibility scope.
Drawings carry `project_id` and are project-bound, so the visibility hop stays
`can_see_project`; the category is a filter column. The membership boundary is never
bypassed by an inline role check; `WP_DETAIL_ROLES` is never widened.

Every new table: `enable row level security; revoke all ... from anon, authenticated;`
then re-grant narrowly.

### `project_categories`

- `grant select to authenticated`.
- Internal SELECT policy: `using ((select public.can_see_project(project_id)))` —
  project-bound membership gate, scalar-subselect wrapped (test 40 eval-once).
- **No** delete grant/policy (deactivate via `is_active`).
- Writes via DEFINER RPCs only (U1).
- **Additive external SELECT arm** so a bound firm can read the NAMES of the categories
  it has a WP in (to label the portal list): gate on the NEW DEFINER helper
  `can_subcon_see_category(id)` (U6) — **NOT** a raw inline `work_packages` subquery (a
  contractor session has no `work_packages` SELECT arm, so a raw subquery returns zero
  rows and the portal label is dead — resolves rls-review + immutability-review majors).

### `project_drawings`

- `grant select to authenticated` (so the `_current` view reads).
- `grant insert (project_id, category_id, title, revision, storage_path, superseded_by, created_by) ... to authenticated`
  — column-scoped, auditable, but the RPC is the only caller. Do **NOT** grant insert on
  `created_at` (let the default apply, as `pra` does).
- **No** UPDATE/DELETE grant.
- Staff SELECT policy: `using ((select public.can_see_project(project_id)))` (the
  `deliverables`/`reports` precedent).
- Append-only TRIPLE enforcement: revoked UPDATE/DELETE + no UPDATE/DELETE policy +
  `BEFORE UPDATE/DELETE/TRUNCATE` `block_write` trigger raising `P0001`.
- **Subcontractor SELECT arm** (U6): a SEPARATE additive permissive policy
  `using ((select public.can_subcon_see_drawing(id)))` — layered ON TOP of the staff arm,
  never substituted (the `labor_logs` bound-contractor self-read precedent). Internal /
  unbound sessions (NULL contractor) match zero rows on this arm, so internal access is
  unchanged.

### Write RPCs — common shape (all of them)

`security definer`, `set search_path = public`; capture role once
(`v_role := public.current_user_role()`); **null-safe** gate
(`if v_role is null or v_role not in ('project_manager','super_admin','project_director')
then raise ... using errcode = '42501'`); membership gate runs **FIRST** so an unknown
id yields `42501` (not a leaked existence signal); `revoke all on function ... from
public, anon; grant execute ... to authenticated`. Revoking from `public` alone is
INSUFFICIENT (Supabase auto-grants EXECUTE to `anon`, and `NULL not in (...)` is NULL so a
bare gate falls through — the exact bug fixed in `20260813002300`). The role ARRAY
includes `super_admin` + `project_director` wherever `project_manager` appears (see-all
roles never locked out, ADR 0058 / pgTAP 90).

### Helper functions (NEW, the `can_see_photo_log` grandchild precedent)

All: `security definer stable`, `set search_path = public`,
`revoke all ... from public, anon; grant execute ... to authenticated`,
`coalesce(..., false)` — never NULL.

- **`can_subcon_see_drawing(p_drawing_id uuid) returns boolean`** — resolve up the chain
  as DEFINER (so it bypasses `work_packages` RLS — the firm cannot SELECT WPs directly):
  ```sql
  -- content rows: a bound firm sees its own categories' drawings.
  -- master visibility (OR d.category_id IS NULL) is gated by an OPEN DECISION below.
  coalesce((
    select exists(
      select 1 from public.work_packages w
      where w.contractor_id = (select public.current_user_contractor_id())
        and w.project_id = d.project_id
        and (w.category_id = d.category_id /* [OPEN] OR d.category_id is null */)
    )
    from public.project_drawings d where d.id = p_drawing_id
  ), false)
  ```
  Must also resolve supersede chains so a firm that can see content row X can see X's
  tombstone/replacement **within its own category** (so the `_current` anti-join is
  correct under the firm's RLS — see the view caveat). NULL/unbound contractor → zero
  rows. Never sees a sibling category's drawings (`w.category_id = d.category_id`).
- **`can_subcon_see_category(p_category_id uuid) returns boolean`** —
  `coalesce(exists(select 1 from public.work_packages w where w.category_id =
p_category_id and w.contractor_id = (select public.current_user_contractor_id())),
false)`. DEFINER-reads `work_packages`; backs the `project_categories` external label
  arm. (Resolves the "dead portal category names" major.)
- **`firm_has_wp_in_project(p_project_id uuid) returns boolean`** —
  `coalesce(exists(select 1 from public.work_packages w where w.project_id =
p_project_id and w.contractor_id = (select public.current_user_contractor_id())),
false)`. DEFINER-reads `work_packages`; backs the storage SELECT policy so the RLS
  session can sign drawing objects (resolves the "dead storage SELECT / tempts widening
  WP RLS" blocker). Do **NOT** widen `work_packages` SELECT to role `contractor`.

### Drawing write RPCs (U4)

- `record_project_drawing(p_project_id, p_category_id, p_title, p_revision,
p_storage_path, p_superseded_by default null)` — inserts the append-only content row
  uploaded by `auth.uid()`. Gate (common shape) + `can_see_project(p_project_id)` FIRST.
  Same-project category guard: non-null `p_category_id` must EXIST + be `is_active` +
  share `p_project_id` else `22023`. **Path↔scope assertion (resolves rls-review major,
  stored-path/authz divergence):** parse `storage.foldername(p_storage_path)` and require
  `segment[1] = p_project_id::text`; for non-null `p_category_id` require
  `segment[2]='category' AND segment[3]=p_category_id::text`, else `segment[2]='master'`;
  raise `22023` on mismatch. **Supersede is insert-only:** when `p_superseded_by` is set,
  the new row carries `superseded_by` pointing at the target id — the RPC NEVER UPDATEs
  the target row (which would fire `block_write` `P0001`). Replace = `record_project_drawing`
  with `p_superseded_by` set.
- `remove_project_drawing(p_id)` — inserts a tombstone row (NULL `storage_path`,
  `superseded_by = p_id`, same `project_id`/`category_id` as the target). Insert-only.

### WP↔category write RPC (U2)

- `set_work_package_category(p_work_package_id, p_category_id)` — clone
  `set_work_package_deliverable` EXACTLY: tier pm/super/director (null-safe gate),
  `can_see_wp` FIRST (unknown WP → `42501`), NULL = uncategorise, non-null category must
  EXIST + be `is_active` + share the WP's project else `22023`, writes `category_id` ONLY.
  SA/PM have no direct `work_packages` UPDATE policy — widening it would leak every WP
  column, so this is the sole writer.

### Category authoring RPCs (U1)

- `create_project_category(p_project_id, p_code, p_name, p_sort_order)` — gate (common
  shape) + `can_see_project(p_project_id)` FIRST; `23505` on duplicate `(project_id,code)`;
  `created_by = auth.uid()`.
- `update_project_category(p_id, p_name, p_sort_order)` — rename/reorder only; bindings by
  id untouched.
- `reorder_project_categories(p_project_id, p_ids uuid[])` — bulk `sort_order` reassign.
- `set_project_category_active(p_id, p_is_active)` — deactivate-not-delete toggle.

### Hole-check (kept explicit; pinned by pgTAP)

(a) cross-project leak impossible — every arm resolves to a concrete project the caller
is a member of OR a concrete WP the firm is bound to. (b) cross-category leak impossible —
`w.category_id = d.category_id`. (c) anon write closed — every RPC revokes public AND
anon + null-safe gates. (d) anon read closed — no broad storage SELECT; the one storage
SELECT is firm-bound (DEFINER helper) and NULL-safe. (e) eval-once — every
helper/`current_user_role()`/`auth.uid()`/`current_user_contractor_id()` call wrapped
`(select ...)`. (f) NULL-role / NULL-contractor → universal deny.

---

## UI surfaces (file paths)

**Term SSOT** in `src/lib/i18n/labels.ts`: `แบบก่อสร้าง` (construction drawing — distinct
from `photo_markups` spec-51 "drawing on a photo", never conflate) + `หมวดงาน`
(work-category — distinct from `งวดงาน` deliverable and `ประเภทโครงการ` `project_type`).
The operator-authored category `name` column IS its label (no enum `Record`); only the
term constants are SSOT'd.

### A) Project detail — `src/app/projects/[projectId]/page.tsx`

- A planner-gated (`isPmRole`) **`หมวดงาน` manager**: list with code/name/sort_order;
  create/rename/reorder/deactivate via the U1 RPCs (mirror where `deliverables` are
  authored).
- A **`แบบก่อสร้าง` panel** managing the project MASTER drawing(s)
  (`record_project_drawing` with NULL category) and per-category drawing rows listed under
  each category; upload via the `catalog-image-control` flow.
- New feature folder `src/components/features/drawings/`
  (`project-drawings-panel.tsx` + `category-manager.tsx`) — **MUST** be added to the
  feature-components-structure allowlist (the `features/sa/` trap noted in memory).
- Loader: extend `src/lib/projects/load-detail.ts` to batch-load `project_categories`
  (ordered) + master drawings (signed via `mintSignedUrls` server-side).

### B) WP detail — `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx`

- In the `จัดการ` manage tab (planner-only): NEW `WpCategoryControl`
  (`src/components/features/work-packages/wp-category-control.tsx` — native select of the
  project's `is_active` categories, ungrouped sentinel `''`, writes
  `set_work_package_category`) sitting alongside `WpDeliverableControl` exactly. The select
  filters inactive categories out but still renders an already-bound inactive category as
  the WP's current value.
- In the `ข้อมูล` info tab: READ-ONLY signed list of the WP's category drawings
  (`WP.category_id → project_drawings_current where category_id matches`) so internal
  staff see exactly the `แบบก่อสร้าง` for that WP's `หมวดงาน` — the surface that makes the
  WP-centric promise concrete.
- **Empty-state nudge** (resolves scope-review minor — adoption cliff): when
  `WP.category_id IS NULL`, the manage tab + the subcon portal show
  `"งานนี้ยังไม่มีหมวดงาน — ผู้รับเหมาจะยังไม่เห็นแบบ"` so the missing-category state is
  visible rather than silently empty.
- Loader: extend `src/lib/work-packages/load-detail.ts` (the WP's category + its category
  drawings, signed) so the tab stays a Server Component.

### C) Subcontractor portal — `/portal` (do NOT widen `WP_DETAIL_ROLES`)

- A bound firm sees, per project it has WPs in, its own WPs' category drawings (+ the
  project master IFF the master-visibility open decision lands "expose"), from
  `project_drawings_current` filtered by the `can_subcon_see_drawing` RLS arm, signed on
  the **RLS session** (new `src/lib/portal/own-drawings.ts`, the `own-documents.ts`
  precedent — never the admin client). Category names labelled via the
  `can_subcon_see_category` arm.
- No new top-level staff nav; entry under existing `/portal`.

Server Components by default; `'use client'` justified only for the file-picker /
upload-then-RPC components. Server actions map `23505`/`42501`/`22023` + `revalidatePath`.
Regenerate `src/lib/db/database.types.ts` via `pnpm db:types` after each schema unit.

---

## TDD unit breakdown

Each unit's first commit is the **failing test** (Vitest unit first for UI; pgTAP first
for DB), per CLAUDE.md. Units form **two ordered dependency chains**, not six independent
units (resolves scope-review minor): **taxonomy track U1→U2→U3**, **drawings track
U4→U5→U6**. Only U1 and U2 are independently valuable before any drawings exist; U3
requires U1+U2 merged, U5 requires U4, U6 requires U4+U5 and the axis decision.

### U1 — `project_categories` taxonomy (DB) — _failing pgTAP first_

- **Migration A:** `project_categories` table (project_id FK cascade, code unique-per-
  project, name + nonblank/cap checks, sort_order, is_active, created_by, timestamps +
  existing `set_updated_at` trigger) + index. RLS (enable; `revoke all from anon,
authenticated`; `grant select`; internal SELECT policy
  `using ((select can_see_project(project_id)))`; NO delete). DEFINER RPCs
  `create_project_category` / `update_project_category` / `reorder_project_categories` /
  `set_project_category_active` — null-safe role gate (pm/super/director),
  `can_see_project` membership FIRST, `23505` on dup code, `revoke all from public, anon`
  / `grant execute to authenticated`.
- **pgTAP** (`supabase/tests/database/NNN-project-categories.test.sql`): RLS on;
  anon-deny; member-sees / non-member-denied; dup-code `23505`; role gate + `42501` on an
  unseen project; no-delete (no grant/policy); eval-once (wrapped subselects).
- `pnpm db:types`.
- **Ship gate:** independently shippable. **Outcome:** per-project category taxonomy
  exists.

### U2 — one-category-per-WP FK (DB) — _failing pgTAP first_

- **Migration B:** `work_packages.category_id uuid NULL references project_categories(id)
ON DELETE SET NULL` + index. `set_work_package_category(p_work_package_id,
p_category_id)` DEFINER — clone `set_work_package_deliverable` EXACTLY: role
  pm/super/director (null-safe), `can_see_wp` FIRST (unknown WP → `42501`), NULL =
  uncategorise, non-null category must EXIST + be `is_active` + share the WP's project else
  `22023`, writes `category_id` ONLY, `revoke all from public, anon`.
- **pgTAP:** column + FK + `ON DELETE SET NULL`; same-project guard `22023`;
  inactive-category rejected; role/membership gate; SA/PM still have no direct WP UPDATE;
  null-role deny; eval-once.
- `pnpm db:types`.
- **Ship gate:** requires U1 merged. **Outcome:** each WP bound to exactly one category.

### U3 — category authoring + WP binding UI — _failing Vitest first_

- `หมวดงาน` manager on project detail (create/rename/reorder/deactivate via U1 RPCs) +
  `WpCategoryControl` in the WP `จัดการ` tab (clone `WpDeliverableControl`).
- `labels.ts` `หมวดงาน` term. Add `src/components/features/drawings/` (and, if a
  WP-category component lands under a new folder, that folder) to the
  feature-components-structure allowlist. Extend `loadProjectDetail` (categories) +
  `loadWorkPackageDetail` (WP category). Server Components; server actions map
  `23505`/`42501`/`22023` + `revalidatePath`. Empty-state nudge on a category-less WP.
- **Vitest:** the pure status/predicate helpers + the category-filter (active-only in the
  picker, but render a bound-inactive category) logic.
- **Ship gate:** requires U1 + U2 merged. **Outcome:** operators define per-project
  categories and tag each WP with exactly one.

### U4 — drawings domain (append-only + supersede) + bucket (DB) — _failing pgTAP first_

- **Migration C:** `project-drawings` PRIVATE bucket (50 MiB, pdf+image mimes) +
  `storage.objects` INSERT policy (`objects.name` qualified; back-office role gate;
  `master|category` folder; **membership gate via `can_see_project` on segment[1]**;
  malformed-path-deny cast guard). `project_drawings` append-only table (project_id
  cascade; `category_id` plain FK; title/revision checks; storage_path nullable;
  superseded_by; composite identity + supersede FK; partial-unique tombstone index; CHECK
  shapes; `created_at NOT NULL default now()`) with `block_write` trigger + no UPDATE/
  DELETE policy/grant + `project_drawings_current` `security_invoker` view; staff SELECT
  `using ((select can_see_project(project_id)))`. RPCs `record_project_drawing` /
  `remove_project_drawing` (null-safe gate; `can_see_project` FIRST; same-project category
  guard `22023`; **path↔scope assertion `22023`**; tombstone/supersede insert-only INSIDE
  the definer — never UPDATE the target), `revoke all from public, anon`.
- Add `PROJECT_DRAWINGS_BUCKET` to `src/lib/storage/buckets.ts` + `buildProjectDrawingPath`
  in `src/lib/drawings/path.ts`.
- **pgTAP:** bucket exists + private + mimes + size; INSERT policy role-bound +
  membership-bound + path-shape; append-only triple-block (UPDATE/DELETE → `P0001`);
  `_current` anti-join (a supersede inserts a new row; the old row drops out, the new row
  appears); supersede is insert-only (target row unchanged); path↔scope mismatch `22023`;
  `can_see_project` SELECT; same-project category guard; null-role deny; eval-once.
- `pnpm db:types`.
- **Ship gate:** independently shippable (internal-only). **Outcome:** master +
  per-category drawings storable/supersedable internally.

### U5 — internal drawing surfaces (UI) — _failing Vitest first_

- `แบบก่อสร้าง` panel on project detail (master upload/replace via `record_` /
  `remove_project_drawing`; client upload to bucket then RPC, **NO downscale**) +
  per-category drawing list under the category manager + READ-ONLY category-drawings view
  on the WP detail `ข้อมูล` info tab (this WP's category). Reuse
  `mintSignedUrls(PROJECT_DRAWINGS_BUCKET, rows)` server-side; `buildProjectDrawingPath`.
  `แบบก่อสร้าง` term in `labels.ts`. Ensure `features/drawings/` is on the allowlist (if
  not done in U3).
- **Vitest:** the pure upload-prep / mime-size validation + the master-vs-category row
  shaping helpers.
- **Ship gate:** requires U4 merged. **Outcome:** full internal drawings management +
  WP-centric read.

### U6 — subcontractor portal access (DB + UI) — _failing pgTAP first_ — **the headline requirement**

- **Migration D:** `can_subcon_see_drawing(p_drawing_id)`, `can_subcon_see_category(
p_category_id)`, `firm_has_wp_in_project(p_project_id)` — all DEFINER STABLE,
  `coalesce(...,false)`, `revoke all from public, anon`. Additive SEPARATE permissive
  SELECT policy on `project_drawings`: `using ((select can_subcon_see_drawing(id)))`.
  Additive external SELECT policy on `project_categories` gated on
  `can_subcon_see_category(id)`. `storage.objects` SELECT policy for `project-drawings`
  paths gated on `firm_has_wp_in_project((storage.foldername(objects.name))[1]::uuid)`
  (NULL-safe; `objects.name` qualified; malformed-path → deny) so the RLS session can sign.
- **pgTAP (the hole-proof file):** a **bound-contractor RLS session** actually signs a
  master (if exposed) + own-category object AND is denied a sibling-category object and an
  other-project object; NULL/unbound contractor → zero rows on every new arm; staff arm
  unaffected; anon denied; eval-once + null-deny (NULL `current_user_contractor_id`
  returns zero rows on BOTH the `project_drawings` and `project_categories` arms);
  WP-reassign A→B flips drawing visibility A→B exactly; supersede a firm-visible drawing →
  the firm's `_current` view shows the new row, not the old; the chosen `is_active`-rule
  case (see open decision).
- Then **Vitest** for the portal loader shaping.
- `src/lib/portal/own-drawings.ts` (RLS-session signed URLs, never admin client) +
  `/portal` `แบบก่อสร้าง` list.
- `pnpm db:types`.
- **Ship gate:** requires U4 + U5 merged AND the subcontractor-axis open decision
  resolved. **Outcome:** end-to-end — a subcontractor assigned to a WP sees that WP
  category's `แบบก่อสร้าง` without widening `WP_DETAIL_ROLES`.

### U7 (optional, low-churn) — `ตามหมวดงาน` grouping lens

`WorkPackageList` category grouping lens on project detail (mirror
`src/lib/deliverables/group-work-packages.ts`) parallel to `ตามสถานะ` / `ตามงวดงาน`. Out
of v1 core; ship only if requested.

---

## Verification (per unit)

- DB units (U1/U2/U4/U6): `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (new file
  green; **pgTAP 90 still green** — every new RPC names `project_director` so the
  completeness catalog passes; **test 40 eval-once** + **test 41 null-deny** green for the
  new public policies). `pnpm lint && pnpm typecheck && pnpm test`.
- UI units (U3/U5/U6 UI): `pnpm lint && pnpm typecheck && pnpm test` green; preview the
  surface, screenshot → Telegram.
- U6 specifically: prove on a **bound-contractor session** (not just the table arm) that a
  master/own-category object signs and a sibling/other-project object is denied.

---

## Open decisions (product judgment — recommendation + flag)

> These were flagged for explicit operator approval before build. (1) Subcontractor-axis
> ✅ RESOLVED (firm axis, confirmed in shipped code). (2) Master-visibility ✅ RESOLVED
> (operator 2026-06-26): master drawings are INTERNAL-ONLY — subcontractors see only their
> own category's drawings; U6 drops the `OR d.category_id IS NULL` arm; no per-drawing
> opt-in in v1. (3)–(6) proceed on the recommendations below.

1. **✅ RESOLVED — Subcontractor axis = the FIRM (`work_packages.contractor_id`).**
   Confirmed against shipped code (CC, 2026-06-26), not assumed: the canonical "assign a
   subcontractor to a WP" path is `set_work_package_contractor(p_work_package_id,
p_contractor_id)` (migration `20260751000000`), which writes `work_packages.contractor_id`
   only; the portal binds that firm via `current_user_contractor_id()` (ADR 0051, migration
   `20260706000100`); and the EXISTING crew-assignments portal already scopes WP visibility on
   exactly this axis — `where w.contractor_id = current_user_contractor_id()` (migration
   `20260759000000`). The DC-worker identity (`current_user_worker_id()`,
   `worker_project_assignment`; migrations `20260756000000` / `20260784000000`) binds a worker
   to a PROJECT, not a WP, so it is not the WP-level "subcontractor on a WP" axis the feedback
   means. Therefore `can_subcon_see_drawing` binds the firm axis as designed — it reuses a
   load-bearing shipped pattern, not a hypothetical one. **Residual (build-time, NOT a
   blocker):** `contractor_id` is nullable and currently sparse (≈0 real projects yet), so U6
   must (a) pgTAP-assert the firm-axis contract on a bound-contractor session, and (b) ship the
   WP empty-state nudge so a category-less / firm-less WP is visibly "ผู้รับเหมาจะยังไม่เห็นแบบ."
   Worker-axis (per-DC-person) drawing visibility stays out of scope (separate spec).

2. **✅ RESOLVED (operator 2026-06-26) → INTERNAL-ONLY** (subcons see only their own
   category's drawings; U6 drops the `OR d.category_id IS NULL` arm; no per-drawing opt-in
   in v1). Original analysis kept for context. Master drawing visible to subcontractors, or internal-only? The `OR d.category_id
IS NULL` arm grants EVERY bound firm the project MASTER for any project it has even one
   WP in. A master construction drawing often carries the whole project (all trades, scopes,
   possibly client/commercial annotations). The feedback text says "project-level MASTER
   plus per-category drawings" as the things a subcontractor relates to, but does not
   clearly grant subcons the master. **Recommendation (tilted to least-privilege per the
   adversarial reviews):** default to NOT exposing the master — ship U6 with only the
   firm's own category drawings (drop the `OR d.category_id IS NULL` arm). Make
   master-sharing an explicit per-drawing opt-in (a `shared_with_subcontractors` boolean on
   the master row, gated by the planner RPC) in a follow-up unit. The per-category arm
   already satisfies the locked requirement. (The earlier synthesis defaulted to "expose";
   two of three reviewers flagged that as the less-safe default — flag to operator.)
   **Options:** expose-master-to-all-bound-firms · master-internal-only (least-privilege) ·
   per-drawing `shared_with_subcontractors` opt-in.

3. **Rename / deactivate a category after WPs are attached?** **Recommendation:** YES to
   rename (`name` is operator-authored presentation, not a storage key —
   `update_project_category` changes name/sort_order; all WP bindings by id are untouched),
   and YES to deactivate-not-delete (`is_active=false` hides it from the WP picker, but
   historical `WP.category_id` bindings and the category's drawings remain — the
   `catalog_items.is_active` + masters-no-delete convention). The picker filters inactive
   categories while still rendering an already-bound inactive category as the WP's current
   value. No hard DELETE. **Sub-question (immutability-review):** does deactivating a
   category hide its drawings from a firm still pointed at it? `can_subcon_see_drawing`
   checks `category_id` equality, not `is_active`. **Recommendation:** deactivation hides
   the category from authoring/new-binding but does NOT revoke drawings from an
   already-bound firm (a firm mid-work should not lose its drawings); pin the chosen rule
   in U6 pgTAP. **Options:** deactivate hides-from-authoring-only (rec) · deactivate also
   hides drawings from bound firms.

4. **Seed categories from a per-`project_type` starter list, or free-form only?**
   **Recommendation:** ship v1 free-form (operator types code/name per project) — the
   minimum, matches `equipment_categories`, avoids a global seed table now. Add an optional
   "apply suggested categories for this project_type" seeding action LATER as its own unit
   (mirroring the dormant `wp_templates` apply pattern keyed by `project_type`), so the
   starter list is a convenience, never a constraint. **Options:** free-form-only (rec) ·
   per-project_type seed catalog now.

5. **CAD/DWG support in v1?** **Recommendation:** PDF + image (jpeg/png/webp/heic) only,
   50 MiB ceiling. DWG/DXF have no safe inline browser render or thumbnail, so accepting
   them stores blobs nobody can preview in-app. Note CAD in Out-of-scope; add later with
   its own `allowed_mime_types` widen + a viewer decision in the bucket migration.
   **Options:** pdf+image-only (rec) · add CAD now.

6. **Split into two specs (207 taxonomy + 208 drawings)?** The scope-doctrine review notes
   this is a 3-concern program (taxonomy, document store, portal access) riding one
   feedback item; U1–U3 (taxonomy) are independently shippable and are the minimal answer.
   **Recommendation:** keep ONE spec file for traceability of the single feedback item, but
   build along the two tracks (U1–U3, then U4–U6) one unit per session per the mandate; if
   the operator prefers separate numbered specs, split the drawings track (U4–U6) into spec
   208 at build time. **Options:** one spec / two tracks (rec) · split 207 + 208.

---

## Out of scope

- CAD/DWG/DXF upload + any in-app drawing viewer/thumbnail (PDF + image only in v1).
- Per-worker (DC-person) drawing visibility — firm-axis only in v1 (see open decision 1).
- A global cross-project category catalog or per-`project_type` seeded starter list (v1 is
  free-form per project; seeding is a later unit).
- Setting a category at WP creation — category is set post-create from the `จัดการ` tab,
  mirroring `deliverable` (an empty-state nudge covers the gap; an optional create-sheet
  picker is a later refinement).
- Master-drawing per-drawing `shared_with_subcontractors` opt-in (only if open decision 2
  lands "internal-only by default").
- Feeding categories into billing, reports, critical-path, or `wp_profit`.
- The `ตามหมวดงาน` grouping lens (U7, optional).
- Orphan-object cleanup for superseded/tombstoned drawings (keep-originals; deferred, the
  `catalog` precedent).
