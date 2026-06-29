# 221 — Managed category taxonomy (enum → table) + product-code derivation

Status: DESIGN — confirmed 2026-06-29 (operator chose **full self-service** for main
categories + **auto-build** the item product code, both via AskUserQuestion).
Relates: spec 175 (catalog), 214 (free product_code), **219 (subcategory taxonomy)**.
Doctrine: [[self-governance-doctrine]] (people manage their own data), UI-term SSOT.

## Why

Spec 219 made **subcategories** a managed table (editable 2-digit code + name). The
**main category** stayed a fixed `item_category` Postgres **enum** (13 values, hardcoded
Thai names in `labels.ts`, no code). Operator: let users manage main categories too
(add / remove / rename / **set the 2-digit code**), and build the item's 6-digit product
code from the taxonomy (`main 2 · sub 2 · sequence 2`) instead of free-typing it. This is
spec 214's explicitly-deferred "model a real main/sub taxonomy + derive codes."

## Blast radius (confirmed)

`item_category` is **catalog-domain only**: columns `catalog_items.category` +
`catalog_subcategories.category`; the composite FK `catalog_items(subcategory_id,
category) → catalog_subcategories(id, category)`; RPCs `create_catalog_item` /
`update_catalog_item` / `create_catalog_subcategory` (`p_category`); ~8 code files
(display labels via `ITEM_CATEGORY_LABEL`); pgTAP `119/120/121`. **No other domain**
(purchase_requests, supply_plan, store) stores it — so the conversion is bounded.

## Design

### Main category becomes `catalog_categories` (replacing the enum)

- `catalog_categories (id uuid pk, code text 2-digit unique, name text, sort_order
smallint, is_active boolean, created_at)`; `check (code ~ '^[0-9]{2}$')`.
- `catalog_items.category` (enum) → `catalog_items.category_id uuid` FK.
- `catalog_subcategories.category` (enum) → `catalog_subcategories.category_id uuid` FK +
  unique `(id, category_id)`; subcategory unique becomes `(category_id, code)`.
- Composite FK `catalog_items(subcategory_id, category_id) → catalog_subcategories(id,
category_id)` (the category-match guard, on uuid).
- The `item_category` enum is **dropped at cutover**.

### Product-code auto-derivation

Item form: choosing category + subcategory fixes `product_code` digits **1-2 = category.code**,
**3-4 = subcategory.code**; the user types only the **2-digit sequence** (digits 5-6).
`product_code` stays the stored 6-digit string (spec 214) but is now **composed**, not free.
Category-only item (no subcategory): digits 1-2 derived, 3-6 a 4-digit free tail. Re-coding a
category later does NOT rewrite already-stored item codes (they are snapshots — noted risk).

### Unified taxonomy manager (the UX)

`/catalog/subcategories` → a **taxonomy tree** (`/catalog/categories`): main categories
(editable code + name) expand to their subcategories (editable code + name), add at both
levels, with the composed code visible (`01` → `0101`). Replaces the subcategory-only screen.

## Units — additive foundation first, the destructive cutover isolated + gated

### U1 — additive foundation · SCHEMA lane · held PR (NOT break-glass)

Migration `20260813018000`, all additive (no drops → reversible):

- `catalog_categories` table + RLS (select to authenticated, RPC writes) + seed the **13**
  enum values (code `01`..`13` in enum order, names from `ITEM_CATEGORY_LABEL`, sort_order).
  A **transient** `legacy_category public.item_category unique` column holds the enum→row
  map for backfill (dropped at cutover).
- `category_id uuid` on `catalog_items` + `catalog_subcategories` (nullable) + nullable FKs;
  **backfill** from `legacy_category`. A `BEFORE INSERT/UPDATE` **sync trigger** on each keeps
  `category_id` current from the enum `category` while the app still writes the enum (so no
  drift before cutover).
- RPCs `create_catalog_category` / `update_catalog_category` (definer, back-office gate,
  revoke public/anon) — name/code/order/active; unique code → 23505. (No delete — deactivate.)
- pgTAP: table + RLS + grants; seed count = 13; backfill correctness; trigger keeps in sync;
  the two RPCs (create/dup/bad-code/update/unknown). `db:types` regenerated.

### U2 — category_id becomes source of truth (enum kept VESTIGIAL) · SCHEMA lane · held PR (NOT break-glass)

**Revised 2026-06-29.** The original plan dropped the `item_category` enum (break-glass,
irreversible). But dropping it is **not required** to deliver the value — a new user-created
main category simply has no enum value. So instead: make `category_id` the source of truth and
leave the enum **vestigial** (nullable, ignored). Fully **additive + backward-compatible** — a
normal held PR, no break-glass. The actual `DROP TYPE` is **deferred** to an optional later
cleanup (its own break-glass unit, or never).

Migration `20260813020000` (additive, backward-compatible):

- enum `category` columns → **nullable** on both tables (a new category has no enum value);
- subcategory identity + the item↔subcategory match move onto `category_id`:
  `unique (category_id, code)` + `unique (id, category_id)` + composite FK
  `catalog_items(subcategory_id, category_id) → catalog_subcategories(id, category_id)`. The
  legacy enum unique/FK stay (just unenforced when `category` is null);
- the **sync trigger** → only fill `category_id` when it's null (the RPCs now set it directly);
- **DROP+CREATE** `create/update_catalog_item` + `create_catalog_subcategory` to add a trailing
  `p_category_id uuid` (default → old enum-only calls still resolve, so the live app keeps
  working in the push→deploy window). `category_id` is the source of truth (explicit wins, else
  derived from the enum); the enum is written through (NULL for a user-created category); the
  subcategory guard now matches on `category_id`.
- pgTAP: `120/121` signature pins → new 9-arg; a new test for the `category_id` path (create by
  `p_category_id`, the guard on `category_id`, a new-category insert with a NULL enum).

The app keeps using the enum until U3 switches it to `category_id` — both work meanwhile.
**U3 carry-forwards (from the U2 adversarial review):** (a) regen `db:types` (the `category`
columns become nullable + RPC Args gain `p_category_id`) and switch every `catalog_items.category` /
`catalog_subcategories.category` read (catalog-list, `/catalog/subcategories`, store, supply-plan) to
`category_id` + a `catalog_categories` join — until then a user-created (enum-null) category can't be
surfaced. (b) `update_catalog_item` writes both columns from `coalesce(p_category_id, derive(enum))`,
so the OLD enum-only edit form could demote a user-category item back to an enum category — U3 must
make the edit path pass `p_category_id` (or preserve `category_id` when `p_category_id` is null and the
row's `category` is already null).

### U2-cleanup — deferred, optional, ⚠️ BREAK-GLASS

Once everything is proven on the table: drop the vestigial enum columns + `legacy_category` +
the sync trigger + `drop type public.item_category`. `pg_dump` floor + preview-branch rehearsal

- operator go (`break-glass.md` Procedure B). **Not required for the feature** — may never run.

### U3 — unified taxonomy manager UX · code-only

The tree screen (main + sub in one place): `AddCategory` / `EditCategory` + the existing
`AddSubcategory` / `EditSubcategory`; add/edit/recode/rename/deactivate both levels; reads
`catalog_categories`. The drill filter (spec 219 U3) already reads names — repoint to the table.

### U4 — product-code auto-derive · code-only

Item form composes digits 1-4 from category.code + subcategory.code; user enters the 2-digit
sequence; validate the stored code's prefix against the chosen taxonomy.

## Verification

Schema units: `pnpm db:test`. All units: `pnpm lint && typecheck && test`. Manual: procurement
adds a category + code, adds subcategories, tags an item, sees the composed product code.

## Open questions / risk

- **U2 is irreversible** (enum drop). Gated on operator break-glass + a verified backup; the
  preview-branch rehearsal must come back clean (catches any unknown enum dependency).
- Re-coding a category after items have codes leaves old item codes unchanged (snapshots).
- Adding/removing a main category is allowed once U2 lands (pre-cutover the 13 are fixed).
