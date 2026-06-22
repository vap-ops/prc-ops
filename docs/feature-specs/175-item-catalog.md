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

## U2 — add catalog item (create)

Make the catalog operable: back-office adds new items in-app. Edit / deactivate of
existing items is U3.

- **Migration `20260802000000`:** `create_catalog_item(category, base_item, spec_attrs,
unit, stockable, note) returns uuid` — SECURITY DEFINER, role-gated to
  pm/super/procurement/director (the `BACK_OFFICE_ROLES` set), inline like
  `apply_wp_template`. Trims inputs (empty spec/note → NULL); length caps
  (base ≤200, unit ≤40, spec ≤200, note ≤1000) → `22023`; the unique-identity index
  raises `23505`. `catalog_items` stays write-locked (no INSERT grant / no write
  policy) — the RPC is the only write path. `revoke … from anon` (the Supabase
  default-privilege EXECUTE-to-anon trap).
- **Action `src/app/catalog/actions.ts`:** `createCatalogItem` — `requireRole(BACK_OFFICE_ROLES)`,
  validates category against `ITEM_CATEGORY_LABEL` keys, calls the RPC under the user
  session, maps `23505`→"already exists" / `42501`→"no permission", `revalidatePath('/catalog')`.
- **`AddCatalogItem` ('use client'):** a BottomSheet form — category select, name, spec,
  unit picker (`COMMON_UNITS` + อื่น ๆ free-text), stockable checkbox, note; submit →
  action → reset + close + `router.refresh`; inline error.
- **Page:** the form button sits above the read-only list on `/catalog`.
- **Tests:** `add-catalog-item.test.tsx` (4: submit-gating, create-with-values + refresh,
  free-text unit reveal, inline error); pgTAP `120-create-catalog-item` (11: exists +
  SECURITY DEFINER, anon-deny + auth-allow execute, PM creates + row lands, procurement
  creates, blank→22023, duplicate→23505, site_admin + visitor→42501).

## U3 — edit / deactivate catalog item

Make the catalog correctable: back-office edits any field of an item, or removes it
(soft delete). Lets the operator fix the seed (e.g. the U1 unit/stockable calls).

- **Migration `20260803000000`:** two more controlled-write RPCs (catalog_items stays
  write-locked — no table grant). `update_catalog_item(id, …) returns void` — SECURITY
  DEFINER, same back-office gate + validation as create; unknown id → `22023`, duplicate
  identity → `23505`. `set_catalog_item_active(id, active) returns void` — soft delete /
  restore (`is_active`). Both `revoke … from anon`.
- **Shared form:** the U2 `AddCatalogItem` field set is extracted to `CatalogItemForm`
  (used by both add + edit, so they can't drift); a seeded unit not in `COMMON_UNITS`
  (วง / ฝา / ตู้) opens as the free-text "other" so the edit preserves it.
- **`EditCatalogItem` ('use client'):** a per-row "แก้ไข" button → BottomSheet pre-filled
  with the item → save (`updateCatalogItem`) or "เอาออก" (`setCatalogItemActive` false →
  drops off the active list, reversible). Injected into each `CatalogList` row via an
  optional `renderRowAction` prop from the page (a render-prop so the list stays free of
  client-action imports — the page, a server component, renders the client edit control).
- **Actions:** `updateCatalogItem` / `setCatalogItemActive` — `requireRole(BACK_OFFICE_ROLES)`,
  UUID-guard, map `23505`/`42501`/`22023`, `revalidatePath`.
- **Tests:** `edit-catalog-item.test.tsx` (4: pre-fill, save+refresh, deactivate+refresh,
  inline error); pgTAP `121-edit-catalog-item` (14: both fns exist + SECURITY DEFINER,
  anon-deny, PM edits + row reflects, unknown→22023, edit-onto-identity→23505, deactivate
  flips is_active, site_admin + visitor→42501). The U2 add test stays green (the extraction
  is behaviour-preserving).

## U4 — item image

One reference photo per item — a thumbnail in the list + on the edit sheet. Matches
"add images to the existing list" (attaches on edit, since the item must exist for its
storage path). Honours the keep-images doctrine: replacing repoints the path, old objects
are retained in the bucket.

- **Migration `20260804000000`:** private `catalog-images` bucket + a back-office INSERT
  policy on `storage.objects` (NO SELECT policy — reads via service-role signed URLs, the
  photos-bucket posture). `catalog_items.image_path text` (inherits the table-level SELECT
  grant — no column-grant trap here). `set_catalog_item_image(id, path) returns void` —
  back-office gate, null clears, unknown id → `22023`, `revoke … from anon`.
- **`CatalogImageControl` ('use client'):** pick a photo → reuse spec-34
  `preparePhotoForUpload` (client downscale) → upload to `catalog-images` at
  `{itemId}/{uuid}.{ext}` via the browser client (the INSERT policy gates it) →
  `setCatalogItemImage` records the path → refresh. Replace + remove. Shown on the
  `EditCatalogItem` sheet.
- **Display:** the page mints 120s signed URLs (`mintSignedUrls`) for items with an
  `image_path` → `thumbnailUrl` on `CatalogItem` → `CatalogList` renders a thumbnail;
  placeholder icon in the control when empty.
- **Tests:** `catalog-image-control.test.tsx` (3: downscale+upload+record+refresh, remove,
  reject-non-image); pgTAP `122-catalog-item-image` (10: bucket + INSERT policy + column +
  RPC gate/secdef/anon-deny + set/clear + unknown→22023 + site_admin→42501).
- **Out of scope:** single current image (an append-only history table is a later option);
  add-time image (add then edit to attach).

## U5 — consistent image slot (+ removed the auto-sourced images)

Operator feedback on the U4 image batch: the auto-sourced CC photos weren't related, and
every row should carry a consistent image slot.

- **Removed** the 8 web images — cleared `image_path` (back to null) and deleted the bucket
  objects (`supabase storage rm --experimental --yes`); the credits doc was deleted. They were
  generic representative photos, not the right items; operator adds real photos via แก้ไข.
- **`CatalogList` always renders a 40px image slot:** the thumbnail when present, else a
  placeholder (`role="img" aria-label="ไม่มีรูปภาพ"` box with an icon) — so rows align whether
  or not an item has a photo. App-only, no DB change.
- **Test:** `catalog-list.test.tsx` (+2: a placeholder per no-image row; the thumbnail renders
  and no placeholder when the item has an image).

## U6 — category filter (select a category first)

Operator: since the list is grouped by category, let users pick a category first (with "All").

- **`CatalogList` becomes a client component** (was a server component + render-prop) to hold the
  filter selection. A `RadioChip` row: **`ทั้งหมด (N)`** (default — the grouped overview) + a chip
  per **present** category with its item count. Selecting one shows just that section.
- Because the list is now a client component, the per-row edit control (`EditCatalogItem`, U3)
  **moved inside `CatalogList`** behind an `editable` prop — a function render-prop can't cross the
  server→client boundary. The page now passes `<CatalogList items={…} editable />` (data only).
- **Test:** `catalog-list.test.tsx` (+3: ทั้งหมด + a chip per present category, no chip for empty
  categories; selecting a category shows only its items; ทั้งหมด restores all). App-only, no DB.

## Out of scope (later units)

Supply Plan (PM bulk plan, qty-per-WP, PD approval);
the store entity + Stock-In; เบิก/Issue + custody; stock-on-hand + counts; sell-rate / store
P&L (the margin layer). Sample prices from the sheet are NOT loaded — price is not item
identity; real cost comes from receipts later.
