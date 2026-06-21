# Spec 175 — Item catalog (on-site storage / inventory foundation)

## Why

The operator now runs an on-site **storage unit** per site (one unit; SA manages it) that
holds both equipment and materials/consumables. The design (see
`docs/inventory-store/README.md`) makes the store a transfer-pricing business unit with
three flows — **Supply Plan** (PM plans, PD approves), **Stock-In** (procurement buys into
the store at cost), and **เบิก/Issue** (a WP draws stock; the store "sells" to the WP) — plus
a custody handshake. The whole arc is staged **cost-first**; the margin/sell-rate layer
is the last unit.

Everything downstream — planning, measuring PM accuracy, stock-on-hand, issue — keys on a
single **item identity**. Today the only "catalog" is the per-site Google Sheet, where the
same item is spelled differently every time (location and spec baked into the name). Without
a shared item master, plan→order→stock→consumption can never be matched. This spec builds
that foundation.

## Scope — U1: read-only seeded catalog + view

A new reference table `catalog_items` (the item master) plus a read-only page that shows it.
Create/edit of items, the Supply Plan, the store, and issue are **later units** (out of scope
here). This unit lands the operator's real item list into the app so there is a single,
viewable source of item identity.

### Data model

- New enum `public.item_category` — 12 stable category codes (Thai labels live in
  `labels.ts`, the SSOT pattern):
  `steel_fixing`, `plumbing_sanitary`, `site_safety`, `roofing`, `ceiling_tile`,
  `electrical`, `door_fire`, `paint`, `masonry_tools`, `paving`, `tank_septic`,
  `custom_fabrication`.
- New table `public.catalog_items`:
  - `id uuid pk default gen_random_uuid()`
  - `category public.item_category not null`
  - `base_item text not null` — the item identity, **without** location/usage
  - `spec_attrs text` (nullable) — size/spec/colour variant detail
  - `unit text not null` — unit of measure; reuses the `COMMON_UNITS` vocabulary
    (`src/lib/purchasing/units.ts`, spec 16 — units are intentionally client-side text,
    not a DB table). Stored as the displayed Thai unit string.
  - `stockable boolean not null default true` — `false` = made-to-order / direct-to-WP
    (cut-to-length roofing, fire doors, stainless fab, engineered tanks), never inventoried
  - `note text` (nullable)
  - `is_active boolean not null default true`
  - `created_at timestamptz not null default now()`
  - unique on `(base_item, coalesce(spec_attrs, ''))` — one identity per item (no drift dups)
- **RLS**: enabled; `revoke all from anon, authenticated`; `grant select to authenticated`;
  one SELECT policy `using(true)`. **No write policy** — seeded by migration / service-role,
  exactly like `wp_templates` (reference data). Create/edit RPC is a later unit.
- **Seed**: the 72 deduped items in `docs/inventory-store/seed-catalog.csv`, derived from the
  operator's previous-site purchase sheet. Units normalised to `COMMON_UNITS` canonical where
  they match (กก.→กิโลกรัม, ม.→เมตร); non-stock lines (freight/service/tax) are NOT items.

### Page

- New route `/catalog` — server component, `requireRole(BACK_OFFICE_ROLES)` (pm / super_admin
  / procurement / project_director: the back-office curators, mirroring the suppliers master).
  A settings drill-down: renders `DetailHeader` (back → /settings) + `BottomTabBar`, no HubNav.
- Renders `catalog_items` grouped by category (label order), each item showing
  `base_item` · `spec_attrs` · `unit`, with a badge for `stockable` (เก็บสต๊อก) vs
  not-stockable (สั่งตรงเข้างาน). Read-only; no controls.
- `/catalog/loading.tsx` → `PageSkeleton`.
- Token classes only (Field-First); ≥44px touch floor where interactive.

### Nav

- `/settings`: a `ทะเบียนวัสดุ` (`CATALOG_LABEL`) door under master-data — shown to managers
  (the `isManager` block) and to procurement (its own block), mirroring `/workers`.
- `BottomTabBar`: add `/catalog` to the `ตั้งค่า` tab `match` list (so the tab stays lit).
- `nav-back-affordance` test: classify `catalog/page.tsx` as a static detail route.

### Labels (SSOT)

- `CATALOG_LABEL = "ทะเบียนวัสดุ"`.
- `ITEM_CATEGORY_LABEL: Record<item_category, string>` — Thai per code.
- Stockable badge labels.

## Tests

- **TDD (vitest, first):** `catalog-list.test.tsx` — `CatalogList` renders one section per
  present category in label order, item rows with unit, stockable vs direct badge, and an
  empty state.
- **pgTAP `119-item-catalog.test.sql`:** table exists + RLS enabled; SELECT policy + grants
  (authenticated read, anon revoked); `item_category` enum has the 12 labels; seed present
  (count > 0, a known item exists, both stockable and non-stockable rows exist); the unique
  identity constraint rejects a duplicate.

## Verification

`pnpm lint && pnpm typecheck && pnpm test`; `pnpm db:test` (file 119 green, suite green);
`pnpm build`. Auth-gated page → verified-by-checklist (the component is unit-pinned, the DB is
pgTAP'd; operator on-device = acceptance).

## Out of scope (later units)

Create/edit catalog items (write RPC); Supply Plan (PM bulk plan, qty-per-WP, PD approval);
the store entity + Stock-In; เบิก/Issue + custody; stock-on-hand + counts; sell-rate / store
P&L (the margin layer). Sample prices from the sheet are NOT loaded — price is not item
identity; real cost comes from receipts later.
