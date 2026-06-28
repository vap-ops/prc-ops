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

### U2 — CUTOVER · ⚠️ BREAK-GLASS (operator-gated, irreversible)

Per `docs/break-glass.md` Procedure B: \*\*verified `pg_dump` floor + preview-branch rehearsal

- explicit operator authorization\*\* before running. Migration:

* `category_id` set NOT NULL (verified no nulls); drop the old composite FK + the enum
  `category` columns on both tables; rebuild the composite FK on `(subcategory_id,
category_id)`; drop `legacy_category` + the sync triggers; **`drop type public.item_category`**.
* **DROP+CREATE** the catalog RPCs to take `category_id uuid` (not the enum). Switch the ~8
  code files to `category_id` + read category names/codes from `catalog_categories` (the
  static `ITEM_CATEGORY_LABEL` retires to a seed/fallback). Update pgTAP `119/120/121`.

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
