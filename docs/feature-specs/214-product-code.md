# 214 — Product code (รหัสสินค้า)

Status: IN PROGRESS — design confirmed 2026-06-28.
Relates: spec 175 (catalog_items + create/update RPCs + /catalog page), spec 180
(PR catalog item picker, substring search). Doctrine: UI-term SSOT, Field-First.

## Why

Feedback `dfd70375` (procurement):

> เสนอให้เพิ่มระบบกำหนดรหัสสินค้าแบบแบ่งหมวดหมู่ … รหัส 6 หลัก เช่น `010120` =
> `01` หมวดหลัก (เหล็ก) · `01` หมวดย่อย (วัสดุโครงสร้าง) · `20` ลำดับสินค้า … พิมพ์
> `0101` ในช่องค้นหาก็เจอเฉพาะ เหล็ก › วัสดุโครงสร้าง … ใช้อ้างอิงเดียวกันทั้งองค์กร
> ทั้งการสั่งซื้อ เบิก ตรวจนับ และรายงาน

A standard, structured **6-digit product code** per catalog item: the first 2 digits
are the main category, the next 2 the sub-category, the last 2 a sequence. Seeing the
code tells the category; typing a code prefix filters to it.

## Design decision (v1 — flexible code, not a modelled taxonomy)

The existing `catalog_items.category` is a **flat 13-value enum** (`item_category`),
not a 2-level main/sub taxonomy. Fully modelling main/sub categories (a join table,
derived codes, enforced consistency) is a large, taxonomy-locking change — and the
company's 2-level taxonomy is a **business decision procurement owns**, not something
to hard-code in the schema.

So v1 stores the code as a **free 6-digit string** that procurement assigns by their
own scheme (the reporter — procurement — already has one). The segment meaning
(main / sub / sequence) is a documented convention conveyed by the digits, **not**
DB-enforced against the `category` enum. This delivers the requested value — code on
the item, prefix search, one shared reference — with a minimal additive migration and
no taxonomy lock. A modelled main/sub taxonomy + auto-derived codes is a later spec if
wanted.

- Format: exactly 6 ASCII digits (`^[0-9]{6}$`), or unset (nullable). Unique when set.
- Assignment: manual, in the existing catalog add/edit form. No auto-generation v1.
- Backfill: none — existing items keep `product_code = NULL`; procurement fills them in
  over time. Search/display degrade gracefully when a code is absent.

## Schema (additive migration — held by the danger-path guard)

`catalog_items`:

- `add column product_code text` (nullable).
- `check (product_code is null or product_code ~ '^[0-9]{6}$')`.
- partial unique index `where product_code is not null` (one item per code; a clash
  raises 23505 → friendly "รหัสนี้ถูกใช้แล้ว").

RPCs (DROP + CREATE to extend the signature — per the DB-migration discipline):

- `create_catalog_item(…, p_product_code text default null)` — validates 6-digit /
  null (22023 on bad format), inserts the code. Default keeps existing named calls valid.
- `update_catalog_item(…, p_product_code text default null)` — same, sets the code.
- Re-`revoke … from public, anon` + `grant execute … to authenticated` for the new
  signatures (the role gate stays inside the body; null-safe — anon-exec audit posture).

`pnpm db:types` regenerates `database.types.ts` (the dependent UI compiles against it,
so the whole feature ships in one held PR).

## UI (code-only, rides in the same held PR)

- **Form** (`catalog-item-form.tsx` via add/edit): a `รหัสสินค้า` field (6-digit,
  optional). `src/lib/catalog/validate.ts` (new) validates `^\d{6}$`-or-empty; the
  `createCatalogItem` / `updateCatalogItem` actions pass `productCode` and map 23505 to
  "รหัสนี้ถูกใช้แล้ว".
- **Display**: the catalog list rows (`catalog-list.tsx`) and the PR picker rows
  (`catalog-item-picker.tsx`) show the code as a mono chip when set.
- **Search**: the `/catalog` browse list (`catalog-list.tsx`) gains a search box that
  matches name / spec / `product_code`, so typing a code prefix (`0101`) filters to it —
  the reporter's core use case, on the surface procurement browses. (Threading the code
  into the PR-creation picker's `PurchaseRequestCatalogItem` + its loaders is a small
  follow-up — kept out of this PR to avoid touching the PR flow.)
- New label SSOT `PRODUCT_CODE_LABEL = "รหัสสินค้า"`; `src/lib/catalog/validate.ts`.

## Verification

- `pnpm db:test` — pgTAP: the column + format CHECK + partial-unique index exist; the
  RPCs accept and store a 6-digit code; a bad format raises 22023; a duplicate code 23505;
  null code allowed.
- `pnpm lint && pnpm typecheck && pnpm test` — validator unit tests, form renders+submits
  the code, list/picker show the code, picker search matches a code prefix.
- Manual: procurement adds/edits an item with a code; the PR picker filters on a code prefix.

## Open questions / deferred

- Dedicated search box on `/catalog` browse (v1 relies on the picker search).
- Auto-derive the main-category digits from `item_category`, or model a real main/sub
  taxonomy + auto-sequence — a later spec; v1 is intentionally a free code.
