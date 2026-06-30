# Spec 225 — Secondary material membership: `catalog_item_categories` junction (ADR 0066 / S4)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D2**. This is **session S4**. **Autonomy class: 🔔 ONE-TAP HOLD** — schema
migration trips the danger-path guard. **Reserved migration timestamp: `20260813031000`.**
Schema is single-lane.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing pgTAP** (junction + RPCs + backfill) and the **failing Vitest**
> (picker union) FIRST. These bullets ARE the red tests.

1. `public.catalog_item_categories(catalog_item_id, category_id, subcategory_id,
is_primary)` exists, **reusing the existing spec-219 composite FK** so a membership row
   can only reference a valid `(subcategory_id, category_id)` pair (see "Reuse the
   composite FK" below). RLS on; `grant select to authenticated`; no direct write grant.
2. Exactly **one** `is_primary = true` row per item, enforced by a partial unique index
   `(catalog_item_id) where is_primary`. The primary row is **backfilled to mirror the
   item's canonical** `category_id`/`subcategory_id` so canonical-home and primary-membership
   can never disagree.
3. **Link / unlink RPCs** (`add_catalog_item_category` / `remove_catalog_item_category`)
   mirror the spec 221 U2 RPC posture; you may not unlink the primary row (raise `22023`)
   and may not duplicate a membership (`23505`).
4. Pickers read the **UNION** of the canonical home and the secondary memberships
   (de-duplicated). A failing Vitest pins: an item with a secondary membership in category
   X appears under X's picker scope as well as under its canonical home.
5. pgTAP pins: composite-FK rejects a mismatched `(subcategory_id, category_id)`; exactly
   one primary; backfill correctness (primary mirrors canonical for every existing item);
   anon-deny; role gate `42501`; eval-once; DEFINER + anon-revoke.
6. `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:test` green.

## Why (ADR 0066 D2 — defect C2)

The canonical-home model gives each item exactly one material drawer. Real items
legitimately belong to more than one grouping (defect **C2**). D2 keeps the canonical home
authoritative (it still drives the 6-digit `product_code`) and adds an **additive**
junction for discoverability only. The junction must **reuse the spec-219 composite FK** so
it can never point at a `(subcategory, category)` pair the canonical schema would reject —
**do not invent a new key.**

## Schema (one additive migration, `20260813031000`)

> **Schema-lane protocol (MANDATORY before any SQL):** APPEND your LANES.md claim with
> branch + reserved ts `20260813031000`, **RE-READ** to confirm no concurrent schema claim,
> **re-verify no later migration landed** (the `+1000` floor moves; if S2's `030000` isn't
> on main yet, coordinate the base — never skip a number). ONE schema lane at a time.

- `public.catalog_item_categories`:
  - `id uuid PK`, `catalog_item_id uuid NOT NULL references catalog_items(id) on delete cascade`,
  - `category_id uuid NOT NULL`, `subcategory_id uuid NULL`,
  - `is_primary boolean NOT NULL default false`,
  - `created_by`, `created_at` (append-style; reuse `set_updated_at` only if you add
    `updated_at`).
- **Reuse the composite FK** — the foreign key on
  `(subcategory_id, category_id) → catalog_subcategories(id, category_id)` is the **same
  composite key** declared in
  `supabase/migrations/20260813020000_spec221u2_category_id_source.sql:20-27`. Copy that FK
  shape; when `subcategory_id` is NULL, the membership is at the category grain (guard the
  null-subcategory case the same way the canonical columns do).
- partial unique index `(catalog_item_id) where is_primary` (one primary per item).
- unique `(catalog_item_id, category_id, coalesce(subcategory_id,'…'))` to block duplicate
  memberships (`23505`).
- RLS: `enable; revoke all from anon, authenticated; grant select to authenticated;` SELECT
  policy matching `catalog_items` visibility (firm-wide vocabulary; confirm at build).
- **Backfill**: for every existing `catalog_items` row, insert one `is_primary = true`
  membership mirroring its `category_id`/`subcategory_id`.

### RPC posture (mirror spec 221 U2)

`add_catalog_item_category(p_item_id, p_category_id, p_subcategory_id)` /
`remove_catalog_item_category(p_item_id, p_category_id, p_subcategory_id)`:
`security definer`, `set search_path = public`; capture role once; **null-safe** gate
`if v_role is null or v_role not in
('project_manager','super_admin','procurement','project_director') then raise … 42501`;
`23505` on duplicate membership; `22023` on unlinking the primary or a bad pair;
`revoke all on function … from public, anon; grant execute … to authenticated`; **never
service_role**.

## Files the downstream session touches (real anchors)

- `supabase/migrations/20260813020000_spec221u2_category_id_source.sql:20-27` — the
  **composite FK** to reuse verbatim (do not invent a new key).
- new `supabase/migrations/20260813031000_spec225_catalog_item_categories.sql`
- new `supabase/tests/database/NNN-spec225-catalog-item-categories.test.sql`
- `src/lib/catalog/categories.ts` — the shared `loadCatalogCategories` reader; extend the
  picker/category readers to UNION secondary memberships where a scope is applied.
- `src/lib/db/database.types.ts` — regenerate after `db:push`.

## Out of scope

- A management UI to add/remove secondary memberships from the item form — the RPCs exist;
  the UI is a later unit. (S4 ships the data layer + the picker union.)
- Changing the canonical `category_id`/`subcategory_id` columns or the `product_code`
  derivation (unchanged — the junction is purely additive).

## Verification

- `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (new file green).
- `pnpm lint && pnpm typecheck && pnpm test`.
- Prove the union: an item linked secondarily to category X shows under X without losing
  its canonical-home grouping.
