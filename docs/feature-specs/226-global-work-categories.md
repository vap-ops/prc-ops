# Spec 226 — Global `work_categories` library + seed (W01–W09) + per-project reconcile FK + ship spec-207 U3c WP binding UI (ADR 0066 / S5)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D4**. This is **session S5** (the biggest schema unit). **Autonomy class: 🔔
ONE-TAP HOLD** — schema migration trips the danger-path guard. **Reserved migration
timestamp: `20260813032000`.** Schema is single-lane.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing pgTAP** (library + seed + reconcile FK + RPCs) and the **failing
> Vitest** (`WpCategoryControl`) FIRST. These bullets ARE the red tests.

1. `public.work_categories` (GLOBAL, firm-wide) exists: `name_th`, `name_en`, stable
   `code` (unique), optional `masterformat_code`, `sort_order`, `is_active`. RLS on;
   `grant select to authenticated`; no direct write grant; deactivate-not-delete.
2. The library is **seeded from the BOQ's reconciled W01–W09 + ~49 subsections**
   (bilingual `name_th`/`name_en`, stable codes; subsections modeled per the chosen grain —
   either a `parent_code`/self-FK or a flat 2-level code, pinned in the migration comment).
3. `project_categories` (spec 207) gains a **nullable** `work_category_id uuid references
work_categories(id)` FK — a per-project category can be **reconciled** to a global one
   without being forced to. `material` axis parity: add `name_en` to the material category
   table too (additive).
4. Write RPCs for the global library (`create_work_category` / `update_work_category` /
   `set_work_category_active`) + a `set_project_category_work_category(p_project_category_id,
p_work_category_id)` reconcile RPC, all mirroring the spec 221 U2 posture (WP/project
   side roles: `project_manager` / `super_admin` / `project_director`).
5. **Ship spec-207 U3c `WpCategoryControl`** — the WP-detail manage-tab control that binds
   a WP to one of its project's `is_active` categories via the **already-shipped**
   `set_work_package_category` RPC (`work_packages.category_id` FK already exists — see
   note). This is **UI wire-up only**, no new WP schema. Empty-state nudge when
   `category_id IS NULL`.
6. pgTAP pins: library table + seed count; reconcile FK nullable + valid; RPC role gate
   `42501`, dup code `23505`, eval-once, DEFINER + anon-revoke. Vitest pins the
   `WpCategoryControl` active-only filter (but render a bound-inactive category as the
   current value).
7. `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:test` green.

## Why (ADR 0066 D4 — defect C3) + the already-shipped note

Per-project free-form work-categories don't generalize (defect **C3**): no shared
bilingual vocabulary, no cross-project reporting, no reusable estimate template, no global
relation for scoped pickers. D4 adds a **global library above** the per-project taxonomy
via a nullable reconcile FK — per-project freedom (and the locked
[[wp-single-category-rule]] single-FK on the WP) is preserved.

**Already shipped (do NOT rebuild):** `work_packages.category_id` FK +
`set_work_package_category` DEFINER RPC landed in
`supabase/migrations/20260813003400_spec207u2_wp_category_fk.sql`. Spec 207 U3c — the
`WpCategoryControl` binding UI — was authored but **never shipped**. So item (5) above is
pure UI wire-up onto an existing RPC; the only schema in S5 is the global library + the
reconcile FK.

## Schema (one additive migration, `20260813032000`)

> **Schema-lane protocol (MANDATORY before any SQL):** APPEND your LANES.md claim with
> branch + reserved ts `20260813032000`, **RE-READ** to confirm no concurrent schema claim,
> **re-verify no later migration landed** (the `+1000` floor moves; if S4's `031000` isn't
> on main yet, coordinate the base — never skip a number). ONE schema lane at a time.

- `public.work_categories` (global): columns above; `check (length(trim(name_th)) > 0)`;
  unique `code`; `is_active` default true. RLS enable + revoke + `grant select` + SELECT
  policy `using (true)`. No delete.
- `alter table public.project_categories add column work_category_id uuid null references
public.work_categories(id) on delete set null;` + index. (Reconcile, never forced.)
- material-axis parity: `alter table public.catalog_categories add column name_en text null;`
  (additive).
- **Seed** W01–W09 + ~49 subs (bilingual, stable-coded) from the BOQ in the same migration
  (`on conflict (code) do nothing`).

### RPC posture (mirror spec 221 U2)

`create_work_category` / `update_work_category` / `set_work_category_active` /
`set_project_category_work_category`: `security definer`, `set search_path = public`;
capture role once; **null-safe** gate `if v_role is null or v_role not in
('project_manager','super_admin','project_director') then raise … 42501`; `23505` on dup
`code`; `22023` on bad arg; `revoke all on function … from public, anon; grant execute …
to authenticated`; **never service_role**.

## Files the downstream session touches (real anchors)

- `supabase/migrations/20260813003400_spec207u2_wp_category_fk.sql` — the **already-shipped**
  WP category FK + `set_work_package_category` RPC (reuse; do NOT recreate).
- `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx:44-48` — the WP
  detail host page where `WpCategoryControl` mounts in the จัดการ manage region (clone
  `WpDeliverableControl` placement).
- new `src/components/features/work-packages/wp-category-control.tsx` — the binding control
  (native select of the project's `is_active` categories; ungrouped sentinel `''`; writes
  `set_work_package_category`). Add the new folder to the feature-components-structure
  allowlist if not already present.
- `src/lib/work-packages/load-detail.ts` — extend to load the WP's category + the
  project's active categories.
- new `supabase/migrations/20260813032000_spec226_work_categories.sql`
- new `supabase/tests/database/NNN-spec226-work-categories.test.sql`
- `src/lib/db/database.types.ts` — regenerate after `db:push`.

## Caveat (carry into the build)

**Reconcile, don't replace.** The per-project `project_categories` stay the binding target
for a WP (the locked single-FK rule); the new GLOBAL `work_categories` sit above them via
the nullable `work_category_id` reconcile FK. A project category with `work_category_id =
NULL` is simply un-reconciled — never an error. Relation R (spec 227) keys off the GLOBAL
library, so a WP only participates in scoped pickers once its project category is reconciled
to a global one (the scoped pickers always fall back to the full catalog when not — spec
228/229).

## Out of scope

- Relation R (the work↔material bridge) — spec 227 / S6.
- Auto-reconciling every existing project category to a global one (left to the operator /
  a later unit; the FK is nullable on purpose).
- A global-library management screen (CRUD UI) — RPCs exist; admin screen is a later unit.

## Verification

- `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (new file green; existing pgTAP
  completeness catalog still green — every new RPC names `project_director`).
- `pnpm lint && pnpm typecheck && pnpm test`.
- Preview WP detail: `WpCategoryControl` binds/unbinds a category; the empty-state nudge
  shows on an uncategorised WP.
