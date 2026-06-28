# 219 — Catalog subcategory taxonomy + 2-level filter (หมวดย่อยวัสดุ)

Status: DESIGN — confirmed 2026-06-28 (operator chose "model a taxonomy table").
Relates: spec 175 (catalog_items + create/update RPCs + /catalog page), spec 214
(free 6-digit product_code — main 2 · sub 2 · seq 2). Doctrine: UI-term SSOT,
Field-First, self-governance (procurement owns + manages its own taxonomy).

## Why

The `/catalog` register (ทะเบียนวัสดุ) filters on **one** axis today: a wrapping row
of 13 `item_category` chips (single-select) + a free-text search. Two problems:

1. **No subcategory axis.** Spec 214's product code already encodes a sub level
   (`010120` = `01` main · `01` sub · `20` seq), and procurement thinks in named drill
   (`เหล็ก › วัสดุโครงสร้าง`) — but the subcategory **names live nowhere** in the app.
   The code gives a grouping key, not a label.
2. **The 13-chip cloud** wraps to 3–4 rows on a phone (the operator's surface), with no
   sense of hierarchy and no way to narrow within a category.

Operator decision (2026-06-28): **model the subcategory as a real taxonomy table** (over
the cheaper "labels map" or "code-only" options), so the names are first-class data the
procurement team manages, and items reference a subcategory by FK.

## Design decisions

### Main level stays the `item_category` enum — only the SUB level is modelled

Do **not** create a `catalog_main_categories` table. `item_category` (13 values) is already
the labeled main axis (`ITEM_CATEGORY_LABEL` SSOT) referenced across the app — the filter,
the PR catalog picker (spec 180), the store. Re-modelling it would ripple everywhere for no
gain. So: **main = the existing enum; subcategory = a new modelled level beneath it.**

### `catalog_subcategories` — the new taxonomy table

| column        | type                      | notes |
| ------------- | ------------------------- | ----- |
| `id`          | `uuid pk default gen_random_uuid()` | |
| `category`    | `public.item_category not null`     | the parent main category (enum) |
| `code`        | `char(2) not null`        | the 2-digit sub code (digits 3–4 of `product_code`); `check (code ~ '^[0-9]{2}$')` |
| `name`        | `text not null`           | Thai display name, e.g. `วัสดุโครงสร้าง` |
| `sort_order`  | `smallint not null default 0` | display order within the category; ties broken by `code` |
| `is_active`   | `boolean not null default true` | |
| `created_at`  | `timestamptz not null default now()` | |

- **Unique `(category, code)`** — one subcategory per code within a main category. A clash
  raises `23505` → friendly "รหัสหมวดย่อยนี้ถูกใช้แล้ว".
- **Unique `(id, category)`** — a redundant key that exists only to back the composite FK
  below (lets Postgres guarantee an item's category matches its subcategory's category).
- **RLS**: enabled; `revoke all from anon, authenticated`; `grant select to authenticated`;
  one SELECT policy `using(true)`. **No write policy** — writes go through definer RPCs,
  exactly the `catalog_items` reference-data pattern (create/edit RPC, not a table grant).

### `catalog_items.subcategory_id` — nullable FK with category-integrity

- `add column subcategory_id uuid` (nullable — existing/uncoded items have none; graceful).
- **Composite FK** `(subcategory_id, category) references catalog_subcategories (id, category)`.
  This is the textbook way to guarantee a chosen subcategory belongs to the item's main
  category — the DB rejects a `เหล็ก` item pointed at a `ประปา` subcategory. (Postgres allows
  a composite FK where one referencing column — `category` — is also a plain column on the
  row; nulls in `subcategory_id` make the whole FK not-checked, so uncoded items are fine.)
  Fallback if the composite FK proves awkward: a simple nullable FK on `subcategory_id` + the
  category-match check inside the write RPC. Composite FK preferred (integrity at the floor).

### Relationship to `product_code` (spec 214) — deliberately decoupled in v1

`subcategory_id` (modelled, named) is the **source of truth for the filter**. `product_code`
stays the **free 6-digit string** from spec 214 — v1 does NOT enforce that its digits 3–4
equal `subcategory.code`. Auto-deriving the code from `category + subcategory + sequence`
(and locking the two together) is a deliberate later unit; v1 keeps the code free so this
spec stays additive and doesn't re-open the 214 "no taxonomy lock" decision. The add/edit
form MAY suggest/prefill code digits from the chosen subcategory, but it's not enforced.

No ADR: this is additive data modelling on the existing reference-table pattern, not an
architecture pivot, and adds **no** enum value.

## Units

### U1 — schema + taxonomy CRUD RPCs  ·  SCHEMA LANE · held PR

> Blocked on the schema lane being free (a held migration lane existed at design time —
> rank-5 batch 3, mig `20260813014000`). Take the single schema lane only when clear; the
> migration timestamp must exceed the latest applied on the shared DB.

- **Migration** (additive; held by the danger-path guard):
  - `create table public.catalog_subcategories (…)` + the two unique constraints + RLS +
    grants + SELECT policy.
  - `alter table public.catalog_items add column subcategory_id uuid` + the composite FK.
  - **Seed one anchor row** — the spec-214 example: `(steel_fixing, '01', 'วัสดุโครงสร้าง')`.
    The rest of the taxonomy is entered by procurement through the U2 UI (self-governance);
    no bulk seed (we don't have the operator's full taxonomy, and it's theirs to define).
  - **RPCs** (definer, `search_path = public`, gate inside body to the back-office set
    `project_manager / super_admin / procurement / project_director`, `revoke … from public,
    anon`, `grant execute … to authenticated` — the anon-exec audit posture):
    - `create_catalog_subcategory(p_category public.item_category, p_code text, p_name text,
      p_sort_order smallint default 0) returns uuid` — validates `^[0-9]{2}$` code (22023),
      non-empty name (22023); unique `(category, code)` clash surfaces as 23505.
    - `update_catalog_subcategory(p_id uuid, p_name text, p_sort_order smallint, p_is_active
      boolean) returns void` — unknown id → 22023. (Codes are immutable once set; re-coding
      is delete+recreate, avoided to keep item FKs stable.)
    - **Extend** `create_catalog_item` / `update_catalog_item` with
      `p_subcategory_id uuid default null` (DROP+CREATE — signature change; default keeps the
      existing 8-arg named callers valid). Body validates the subcategory exists AND its
      `category` equals `p_category` (22023 on mismatch) before insert/update. Re-`revoke`
      + `grant` the new 9-arg signature; refresh the COMMENT.
- `pnpm db:types` regenerates `database.types.ts` (the U2/U3 UI compiles against it).
- **pgTAP**: table + both unique constraints + the composite FK exist; RLS on + grants
  (authenticated SELECT, anon none); `create_catalog_subcategory` stores a row, bad code →
  22023, dup → 23505; `update_catalog_subcategory` unknown id → 22023; the item RPCs accept a
  valid subcategory and reject a category-mismatched one (22023); anon cannot write.

### U2 — taxonomy management UI + item-form subcategory picker  ·  code-only

- A back-office surface to CRUD subcategories per main category — a `/catalog` drill (e.g.
  `จัดการหมวดย่อย`), gated `BACK_OFFICE_ROLES`. List grouped by `item_category`; add/edit/
  deactivate a subcategory (code + name + order). Server actions wrap the new RPCs; map
  23505 → "รหัสหมวดย่อยนี้ถูกใช้แล้ว", 42501 → not-permitted.
- `catalog-item-form.tsx` (add/edit) gains a **cascading subcategory `<select>`** scoped to
  the chosen main category (changing the category resets the subcategory). Optional — an item
  may have no subcategory. The create/update item actions pass `subcategoryId`.
- Term SSOT: `CATALOG_SUBCATEGORY_LABEL = "หมวดย่อย"` (+ manage-screen labels) in `labels.ts`.

### U3 — the 2-level filter redesign  ·  code-only (the original ask)

Rewrite `catalog-list.tsx` from the flat chip cloud to a **drill**:

- **Search** on top, unchanged behaviour — when the query is non-empty it flattens the
  hierarchy to a result list (search overrides drill).
- **หมวดหลัก strip** — horizontal-scroll row of category chips with per-category counts,
  single-select (replaces the wrapping cloud; one row, swipeable — reuse the established
  per-strip `overflow-x-auto min-w-max` pattern).
- **หมวดย่อย strip** — appears once a category is selected; chips read **real names** from
  `catalog_subcategories` (joined via `subcategory_id`), with counts. Items in the category
  with no subcategory fall into a trailing `ยังไม่มีหมวดย่อย` bucket (graceful — most items
  start uncoded).
- **Breadcrumb** `ทั้งหมด › {category} › {subcategory}` — orientation + tap a crumb to pop a
  level (one-tap reset).
- **Results** group by subcategory when a category is selected (sub-headers), else by
  category. Row layout unchanged (thumb · name · code chip · spec · unit · actions).
- The `/catalog` page (`page.tsx`) loads `catalog_subcategories` (active) + each item's
  `subcategory_id` and passes them to `CatalogList`.

## Verification (per unit)

- `pnpm db:test` — the U1 pgTAP plan above.
- `pnpm lint && pnpm typecheck && pnpm test` — RPC-wrapper action tests; the form renders +
  submits the cascading subcategory; the manage screen CRUD; the filter derives subcategory
  chips, drills, and the breadcrumb pops levels; the `ยังไม่มีหมวดย่อย` bucket renders.
- Manual: procurement adds a few subcategories under `เหล็ก`, tags items, and drills the
  filter `เหล็ก › วัสดุโครงสร้าง` on a phone.

## Open questions / deferred

- Auto-derive `product_code` from `category + subcategory + sequence` (and lock the code's
  digits 3–4 to `subcategory.code`) — a later unit; v1 keeps the 214 code free.
- Bulk taxonomy import (CSV) if procurement's list is large — U2 is per-row to start.
- Whether the manage UI lives under `/catalog` or `/settings` — settled in U2 (lean `/catalog`
  drill, mirroring the suppliers master).
