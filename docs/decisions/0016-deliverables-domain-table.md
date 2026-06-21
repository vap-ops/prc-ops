# ADR 0016: Deliverables domain table + work_packages.deliverable_id

## Status

Accepted (documented after the fact — shipped to prod 2026-05-31,
recovered from drift 2026-06-07).

This ADR is **as-built**: the two migrations it describes were applied
directly to the live Supabase project on 2026-05-31 and were never
committed to git. They were recovered verbatim on 2026-06-07 from
`supabase_migrations.schema_migrations.statements` and committed on
`chore/recover-migration-drift`. This document is written from the
recovered SQL and the design context already captured in
[`docs/v2-handoff.md` §4](../v2-handoff.md) ("Deliverable grouping in
reports"). No design rationale is invented beyond what those sources
support.

Because this work shipped first, it **owns the ADR-0016 and feature
spec 04 numbers**. Any other in-flight work that was tentatively using
those numbers must be renumbered to the next free slot.

Extends ADR 0011 (`current_user_role()` is the only role-check primitive
in policies) and ADR 0013 (role-level access model for `projects` and
every table that hangs off it).

## Context

`work_packages` is the granular unit of construction work; the v1
schema models ~80 of them per pilot. The source CSVs already carry a
`DeliverableID` column (D01–D30) that groups WPs into coarser,
customer-recognisable deliverables. v1 reports flatten that grouping
away; the deliverable-grouping v2 candidate (v2-handoff §4) restores
it in the PDF and in the upstream queries.

That work has three phases — **schema → importer → PDF layout**. This
ADR is the schema phase. The importer and the PDF layout change have
not shipped and are not in scope here.

Two modelling options were available for the schema phase:

- **(A) Denormalised columns on `work_packages`.** Add
  `deliverable_code text` and `deliverable_name text` directly onto
  `work_packages`. No new table. Rename drift across rows; no home
  for future deliverable attributes; sort order has to be re-derived
  per row.
- **(B) Relational — a `deliverables` table referenced by FK from
  `work_packages`.** One row per (project, deliverable); a nullable
  FK on `work_packages`. Name and order live in one place; future
  deliverable attributes (Amount, status, dates) have a natural home
  if they are ever brought in scope.

(B) was adopted. Only `code`, `name`, and `sort_order` are modelled
in this ADR — every other potential attribute is explicitly out of
scope until a feature actually needs it.

## Decision

Two migrations, applied in order:

### Migration `20260531000000_create_deliverables`

A new table `public.deliverables`:

| Column       | Type          | Notes                                               |
| ------------ | ------------- | --------------------------------------------------- |
| `id`         | uuid PK       | default `gen_random_uuid()`                         |
| `project_id` | uuid NOT NULL | FK → `public.projects(id)` ON DELETE CASCADE        |
| `code`       | text NOT NULL | e.g. `D01`; unique **per project** (see constraint) |
| `name`       | text NOT NULL | customer-facing label                               |
| `sort_order` | int NOT NULL  | render order (`DeliverableOrder`, 1..30 in v1 data) |
| `created_at` | timestamptz   | NOT NULL, default `now()`                           |
| `updated_at` | timestamptz   | NOT NULL, default `now()`; maintained by trigger    |

Constraints & supporting objects:

- **`deliverables_project_code_unique unique (project_id, code)`** —
  each pilot gets its own `D01–D30`, exactly like WP codes are unique
  per project (`work_packages_project_code_unique`).
- **Index `deliverables_project_id_idx`** on `(project_id)` — the
  unique constraint already provides a prefix-matching index, but a
  bare project_id index is created explicitly so the intent stays
  visible and a future change to the unique constraint cannot
  accidentally remove the project_id index. Same defensive duplicate
  pattern as `work_packages_project_id_idx`.
- **Trigger `deliverables_set_updated_at`** — BEFORE UPDATE, calls
  the existing `public.set_updated_at()` defined in the create_users
  migration. The function is **not** redefined.
- **`alter table public.deliverables enable row level security`**.

RLS policies (role-level per ADR 0013, gated via
`public.current_user_role()` per ADR 0011, mirroring `work_packages`):

| Policy                                      | For    | Roles                                          | Note                                    |
| ------------------------------------------- | ------ | ---------------------------------------------- | --------------------------------------- |
| `deliverables readable by privileged roles` | SELECT | `site_admin`, `project_manager`, `super_admin` |                                         |
| `deliverables insert by pm or super_admin`  | INSERT | `project_manager`, `super_admin`               | deliverables are authored / imported    |
| `deliverables update by pm or super_admin`  | UPDATE | `project_manager`, `super_admin`               | both `USING` and `WITH CHECK` are gated |

**No DELETE policy.** With RLS enabled and no DELETE policy, every
DELETE issued through an authenticated session affects 0 rows —
including `super_admin`. Hard deletes require a service-role context
(explicit migration, console action). This is the same
archive-not-delete contract `projects` and `work_packages` ship with;
it is **deliberate**, not omitted.

### Migration `20260531000100_add_work_packages_deliverable_id`

Adds the linking column on the WP side:

```sql
alter table public.work_packages
  add column deliverable_id uuid
    references public.deliverables(id) on delete set null;

create index work_packages_deliverable_id_idx
  on public.work_packages (deliverable_id);
```

- **Nullable.** A WP with no deliverable is valid and renders in an
  "Ungrouped" bucket. The pilots have full D01–D30 coverage, but the
  column must tolerate gaps for future projects.
- **`on delete set null` (not cascade).** Removing a deliverable must
  **never** delete work packages — it only severs the grouping link.
- **Index** for grouped-WP queries (joining WPs to their deliverable,
  ordering by deliverable then code).

## Scope

**In scope (this ADR):**

- The `deliverables` table with the columns, constraint, index,
  trigger, and four RLS rules above.
- The `work_packages.deliverable_id` nullable FK + supporting index.

**Out of scope:**

- The CSV import path that populates `deliverables` and back-fills
  `work_packages.deliverable_id`. Source CSVs already carry the
  `DeliverableID` column; the importer is the next phase.
- The PDF report layout change that surfaces grouping in output.
- Any deliverable-level attribute beyond `code`, `name`, `sort_order`
  (Amount, status, dates, owner, …). They have a natural home in this
  table when their owning features are spec'd.
- A `deliverables` admin UI. Authoring is via importer + SQL until a
  feature requires more.

## Consequences

**Positive**

- Deliverable name and order live in one row, referenced by many WPs
  — no rename drift, no per-row denormalisation.
- There is a natural home for future deliverable attributes without
  schema churn on `work_packages`.
- Policies mirror `work_packages` exactly — same role set, same
  helper, same omission of DELETE. One pattern to reason about.

**Negative**

- One more table to maintain RLS for. Every future role added to the
  domain (project_coordinator, technician, …) must be evaluated
  against `deliverables` alongside `projects` / `work_packages`.
- The grouping value only manifests once the importer + PDF layout
  phases ship. As of this ADR landing, the table is empty
  (`deliverable_count = 0`) and no WPs reference a deliverable.

**Neutral**

- `ON DELETE CASCADE` on `deliverables.project_id` is a defensive
  default that the application path never reaches — application
  writers cannot DELETE `projects` (ADR 0013 forbids it). It only
  matters if a service-role context ever hard-deletes a project.

## How this shipped (and why this ADR is written after the fact)

The migrations were authored against the live DB on 2026-05-31, then
the local commit step was skipped. The drift was first surfaced on
2026-06-07 when `pnpm db:push` for an unrelated unit
(profile-management) refused to proceed against a remote whose
history table contained two migrations not in
`supabase/migrations/`. The SQL was still preserved verbatim in
`supabase_migrations.schema_migrations.statements`, so recovery did
not require `supabase db pull` or any shadow-DB diff. The two files
in this commit are the live DB's SQL, byte-for-byte; the only
non-recovered content in each is a one-line provenance comment.

A separate completeness audit confirmed that nothing else exists on
the remote that is not produced by the union of committed +
recovered migrations: 8 tables, 7 functions, 7 enums, 19 RLS
policies, 23 indexes, 12 triggers, 2 storage buckets, 0 extra custom
roles. (See the chore PR description for the queries used.)

## Amendment — งวด lifecycle (2026-06-21, spec 165)

The original scope froze `deliverables` to `code` / `name` / `sort_order` and
the table to archive-not-delete (no DELETE policy). Spec 165 (operator-driven)
extends the lifecycle; this records the decisions:

1. **Rename / reorder are in scope** — they only mutate `name` / `sort_order`,
   the fields this ADR already owns (`set_deliverable_name`,
   `swap_deliverable_order`; SECURITY DEFINER, membership-gated via
   `can_see_project`).
2. **Delete-empty is a deliberate exception to the no-DELETE contract**, exactly
   as ADR 0059 §3 added for work packages. `delete_deliverable` hard-deletes a
   งวด **only when no `work_packages` reference it** (P0001 otherwise), and is
   audited. A populated งวด is emptied first by ungrouping its งาน
   (`set_work_package_deliverable(…, null)`), then deleted. There is **no**
   `status` column — "archive" is delete-empty, not a soft-archive flag
   (operator decision 2026-06-21: a status enum was explicitly declined).
3. **Money / dates stay OUT of this table.** A งวด's contract amount and
   billing dates will **link to `client_billings` (ADR 0057 / spec 149)** — the
   per-งวด billing that already exists — rather than duplicating fields here
   (operator decision 2026-06-21). That integration is its own spec, not part
   of spec 165.

## References

- ADR 0011 — `current_user_role()` SECURITY DEFINER helper (the role-check
  primitive every policy here calls)
- ADR 0013 — Project access model: role-level only for v1 (the access
  model the deliverables policies follow)
- [`docs/v2-handoff.md` §4](../v2-handoff.md) — Deliverable grouping
  in reports (the originating v2 candidate; lists "Schema + importer
  - PDF layout change. Source CSVs already carry `DeliverableID`
    D01–D30 — ready to backfill.")
- [`docs/feature-specs/04-deliverable-grouping.md`](../feature-specs/04-deliverable-grouping.md)
  — the spec this ADR's schema serves
- `supabase/migrations/20260531000000_create_deliverables.sql` — Part 1
- `supabase/migrations/20260531000100_add_work_packages_deliverable_id.sql` — Part 2
