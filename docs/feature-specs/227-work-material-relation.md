# Spec 227 — Relation R: `work_category_material_categories` bridge + seed (ADR 0066 / S6)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D5**. This is **session S6** (the last schema unit before the code-only
pickers). **Autonomy class: 🔔 ONE-TAP HOLD** — schema migration trips the danger-path
guard. **Reserved migration timestamp: `20260813033000`.** Schema is single-lane.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing pgTAP** (bridge + seed + RPC) FIRST. These bullets ARE the red tests.

1. `public.work_category_material_categories(work_category_id, category_id, kind_filter)`
   exists on the **GLOBAL** library: `work_category_id → work_categories(id)`,
   `category_id → catalog_categories(id)`, `kind_filter` nullable (a `catalog_item_kind`
   enum value or NULL = no kind filter). RLS on; `grant select to authenticated`; no direct
   write grant.
2. Unique `(work_category_id, category_id, coalesce(kind_filter,…))` — no duplicate
   relation rows (`23505`).
3. The bridge is **seeded from the BOQ** so each seeded work-category maps to the
   material-categories it typically buys (optionally `kind`-filtered).
4. A link/unlink RPC (`add_work_category_material_category` /
   `remove_work_category_material_category`) mirrors the spec 221 U2 posture.
5. A read helper resolves, for a given `work_category_id`, the set of
   `(category_id, kind_filter)` rows — this is the function the scoped pickers (specs
   228/229) consume.
6. pgTAP pins: bridge FKs valid; seed present; unique blocks dup; role gate `42501`;
   eval-once; DEFINER + anon-revoke.
7. `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:test` green.

## Why (ADR 0066 D5)

The two axes are now both modeled (material: spec 221/219 + facets spec 224; work: global
library spec 226), but nothing connects them — so a picker can't know which materials a
work-category buys. D5 adds the **bridge on the global library** that **powers the scoped
pickers** (the operator's UC1/UC2). It lives global (not per-project) so every project's
reconciled work-category benefits from one shared mapping. `kind_filter` lets a relation
narrow to, e.g., only `material`-kind items of a category.

## Schema (one additive migration, `20260813033000`)

> **Schema-lane protocol (MANDATORY before any SQL):** APPEND your LANES.md claim with
> branch + reserved ts `20260813033000`, **RE-READ** to confirm no concurrent schema claim,
> **re-verify no later migration landed** (the `+1000` floor moves; if S5's `032000` isn't
> on main yet, coordinate the base — never skip a number). ONE schema lane at a time.

- `public.work_category_material_categories`:
  `id uuid PK`, `work_category_id uuid NOT NULL references work_categories(id) on delete
cascade`, `category_id uuid NOT NULL references catalog_categories(id) on delete cascade`,
  `kind_filter catalog_item_kind NULL`, `created_by`, `created_at`.
- unique `(work_category_id, category_id, coalesce(kind_filter, 'none'))` (or a partial
  index pair to handle the NULL — pin the chosen approach in the migration comment).
- RLS enable + revoke + `grant select to authenticated` + SELECT policy `using (true)`.
- **Seed** the BOQ-derived mappings in the same migration (`on conflict do nothing`).

### RPC posture (mirror spec 221 U2)

`add_work_category_material_category(p_work_category_id, p_category_id, p_kind_filter)` /
`remove_work_category_material_category(...)`: `security definer`, `set search_path =
public`; capture role once; **null-safe** gate `if v_role is null or v_role not in
('project_manager','super_admin','procurement','project_director') then raise … 42501`;
`23505` on dup; `22023` on bad arg; `revoke all on function … from public, anon; grant
execute … to authenticated`; **never service_role**.

## Files the downstream session touches (real anchors)

- new `supabase/migrations/20260813033000_spec227_work_material_relation.sql`
- new `supabase/tests/database/NNN-spec227-work-material-relation.test.sql`
- new `src/lib/catalog/scoped-categories.ts` (or extend `src/lib/catalog/categories.ts`) —
  the `(work_category_id) → [(category_id, kind_filter)]` resolver the scoped pickers call.
- `src/lib/db/database.types.ts` — regenerate after `db:push`.

## Out of scope

- The scoped pickers themselves — specs 228 (supply-plan / UC1) and 229 (WP-detail / UC2).
- A relation management UI — RPCs exist; admin screen is a later unit.

## Verification

- `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (new file green).
- `pnpm lint && pnpm typecheck && pnpm test`.
- Prove the resolver: a seeded work-category returns its mapped `(category_id, kind_filter)`
  rows; an unmapped work-category returns an empty set (the pickers' show-all fallback
  depends on this — spec 228/229).
