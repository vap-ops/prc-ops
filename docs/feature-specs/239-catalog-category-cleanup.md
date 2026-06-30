# Spec 239 — ทะเบียนวัสดุ category cleanup + item-model redesign (ADR 0066 C1)

**ADR:** [0066](../decisions/0066-procurement-taxonomy-redesign.md) D1/D3. **Supersedes/subsumes
[spec 232](232-category-rehome-breakglass.md)** — the C1 re-home, now DE-RISKED to an additive
migration (verified live: **0 of 256 catalog items have any `product_code`** → re-home renumbers
nothing → NOT break-glass). Material axis only; the work-category axis is untouched.

Operator-approved design (2026-06-30, decisions A–G + lead_time + multi-category + equipment).
Two build units:

- **U1 (this spec, schema/data) — 🔔 ONE-TAP HOLD** — migration `20260813043000` + `search_terms` +
  `lead_time_days` columns + pgTAP. The category re-grain + item re-home.
- **U2 (code, ✅ AUTO-MERGE)** — the item-form learn-by-doing + multi-category control + browse-by-union
  - flatten subcategory UI. (Separate PR.)

## U1 — Acceptance criteria (test-first)

### A. Two additive columns on `catalog_items`

- `search_terms text` (nullable) — search synonyms / alt names.
- `lead_time_days int` (nullable, CHECK `>= 0`) — normal days to procure (serves the ordering plan +
  pairs with `made_to_order`).

### B. Category re-grain (repurpose the 4 freed codes; reuse, no dead rows)

**Renames (code unchanged):** 01 → `เหล็กโครงสร้าง` · 02 → `ประปา / สุขาภิบาล` · 03 →
`วัสดุหน้างาน / ความปลอดภัย` · 08 → `สี / เคมีก่อสร้าง`.
**Repurpose (rename + redistribute items):** 09 → `เครื่องมือ / อุปกรณ์ช่าง` · 10 →
`คอนกรีต / ปูน / มวลรวม` · 12 → `งานผนัง / ผิวอาคาร` (cladding) · 13 → `ทั่วไป / อื่น ๆ` (catch-all).
**New:** code `14` → `อุปกรณ์ยึด / น็อต สกรู` (fasteners — the steel split's second half).
All categories stay **active**; nothing deleted/deactivated (repurpose = the truest "reuse codes").

### C. Item re-home (every move = `category_id` + `kind`/`fulfillment` as noted; sync the

`catalog_item_categories` is_primary row to the new canonical)

- **Steel split (cat 01):** the **12 fasteners** (`base_item LIKE 'ตะปู%' OR 'สกรู%' OR 'ลวด%' OR
'พุก%' OR = 'L-Bolt'`) → cat 14. The other 50 (structural) stay in 01.
- **Tanks merge:** cat 12's 8 tank items → cat 02. (Then 12 holds cladding.)
- **Tools:** cat 09's 7 tools + cat 10's 2 tools (ใบตัดคอนกรีต, ลูกดิ่ง) → cat 09 (tools), `kind=tool`
  except เครื่องฉาบปูนมอต้าร์ + เครื่องดัดเหล็ก → `kind=equipment`.
- **Concrete:** cat 09's คอนกรีต Cylinder + คอนกรีตกำลังอัด (→ `made_to_order`) + ทรายหยาบ → cat 10.
- **Cladding:** cat 13's งานอลูคอมโพสิต + ราว/รางสแตนเลส → cat 12, `kind=assembly` (fulfillment already
  `made_to_order`).
- **Roofing:** cat 13's 2 ครอบสแตนเลส → cat 04 (fulfillment already `made_to_order`).
- **Catch-all:** ไดวอล (cat 09) → cat 13 (kind=material, off_shelf) — re-home when recognized (D).

### D. Invariants (pgTAP `247`)

1. Both new columns exist; `lead_time_days` CHECK `>= 0`.
2. Categories: 01/02/03/08 renamed; 09/10/12/13 repurposed (new names); cat 14 exists; **all active**.
3. **No active item has `category_id IS NULL`** (the invisibility guard).
4. Re-home spot-checks: a fastener (e.g. `ตะปู`) is in cat 14; ครอบสแตนเลส in cat 04; the 2 fab bundles
   in cat 12 with `kind=assembly`; concrete in cat 10 `made_to_order`; the 9 tools in cat 09 with
   `kind IN (tool, equipment)`; the 8 tanks in cat 02; no item left in the OLD meaning of 09/10/12/13.
5. **Exactly one `is_primary` `catalog_item_categories` row per item, matching its (category_id,
   subcategory_id)** — re-homed primaries updated.
6. Every re-homed item still `product_code IS NULL` (no code shifted).
7. No orphans: every PR / stock\_\* / supply_plan_lines row referencing a re-homed item still resolves
   (FKs are on `catalog_items.id`, unchanged).

## Migration approach

ONE additive transaction: add columns → create cat 14 → renames → repurpose 09/10/12/13 (rename) →
re-home items (set-based UPDATEs by current category + name pattern) → set kind/fulfillment →
sync `catalog_item_categories` is_primary to canonical → audit_log row. Reversible by re-UPDATE.
No DROP, no deactivation, no `pg_dump` floor. Trips the danger-path guard (migrations/) → operator
one-tap.

## Out of scope (U2 / later)

The item-form UX + multi-category control + browse-by-union + flatten subcategory UI = **U2**.
Migrating the 2 machines into `equipment_items` as tracked assets = later optional. The qty-only
ordering-plan templates = the next epic. Retire the dormant BOQ screen = folded into U2 or separate.

## Verification

`pnpm db:test` (`247-spec239-catalog-cleanup.test.sql`); `pnpm lint && pnpm typecheck && pnpm test`
green (regen `database.types.ts`).
