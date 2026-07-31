# Spec 385 — ทะเบียนเครื่องมือ/เครื่องจักร as a SKU catalog (`equipment_catalog_items`)

**Status:** spec + U1 shipped together, 2026-07-31 (mig `20260813075887` APPLIED).
**Origin:** operator, 2026-07-31, correcting the session's earlier instance-grain
seed — verbatim:

> เครื่องตบดิน is supposed to be only 1 in ทะเบียน, as in SKU. then user can pick
> from ทะเบียน when they want to add new equipments.

> do not seed the equipment items, only SKUs

> why not use the keyword consistent, catalog?

---

## 1. The model

Two grains, two tables, one word (`catalog`) shared with the material side:

| Grain         | Table                              | Holds                                                                                                                                         |
| ------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ทะเบียน (SKU) | `equipment_catalog_items` **NEW**  | one row per type: name (เครื่องตบดิน, once) · category · brand/model · `default_tracking` · `default_daily_rate` (money-walled) · `is_active` |
| Physical unit | `equipment_items` (unchanged role) | No.x instances: serial · condition · 4 photos (382) · QR (370) · movements · borrow logs · per-unit `daily_rate`                              |

`equipment_items.equipment_catalog_item_id` (nullable FK) says which SKU a unit
instantiates. Nullable during transition; the U2 pick flow sets it, and it
tightens to NOT NULL only when every instance row is catalog-born (§5 U4).

Naming: `catalog` is the operator's keyword — the family is now `catalog_items`
(materials) · `equipment_catalog_items` (owned plant/tools) · `rental_catalog_items`
(spec 361 U1, external rentals, still queued). The FK column is spelled out in
full (`equipment_catalog_item_id`, not `catalog_item_id`) because `catalog_item_id`
already means "materials catalog row" in every stock table.

**Category placement moves UP a grain.** The function-first principle
(spec 367 §12, operator 2026-07-31: "the principle behind categories must exist")
now binds the SKU: a type is categorised once, units inherit through the FK.
`equipment_items.category_id` stays for now (live NOT NULL column with UI
readers); the U2 flow copies it from the SKU, and its retirement is U4's call.
This also re-grounds the 2026-07-31 "share categories across materials and
equipment?" ruling (**refused, bridge-not-merge**) at the correct grain: the two
SKU catalogs stay separate tables with separate taxonomies; purchasable
equipment meets the material world through `catalog_items.kind='equipment'`
at purchase time, never through a merged category list.

## 2. Decisions (all live in mig `075887`)

1. **Duplicate-name protection at birth** — partial unique index on
   `lower(trim(name)) where is_active`. The spec-344 consolidation (27 dup pairs,
   fold-and-retire) exists because materials got this only after the fact.
2. **Money wall = column ABSENCE, mirrored** — `default_daily_rate` (numeric(12,2),
   matching `equipment_items.daily_rate`) carries NO authenticated grant in any
   direction (equipment_items precedent, ADR 0055 decision 6). Consequence, stated
   deliberately: **until U2/U3 ship their DEFINER seam, no app path can read or
   change the seeded defaults** — the equipment_items precedent pairs its wall with
   `set_equipment_daily_rate`, and this table's twin RPC is U3's first task. The
   U2 pick flow copies default → per-unit `daily_rate` server-side for the same
   reason (an RLS client cannot see the column).
3. **Write audience DELEGATES to `is_back_office()`** (the storage-RLS lesson —
   a policy restating a helper's role list rots when the helper widens). Read
   audience = back office + `site_admin` (the field sees the pick list).
4. **Seed = 39 SKUs from the operator's 2-branch tool sheet**, including มี-0
   types (ปลั๊กพ่วงไฟฟ้า ทำเอง): a SKU is what CAN be owned/picked, not what is
   currently held. Rates on the operator-approved 2026-07-28 estimate scale.
   Seed is guarded on the dev-preview user existing, so schema-only replays
   (preview branches) skip it instead of failing the FK.
5. **§0 folds the same-day ad-hoc category ops into the artifact of record**
   (change-management §1): the 2 renames + insert-if-missing of ALL ELEVEN
   categories §5 references (the 4 new + the 7 legacy, renamed forms) — no-ops
   on prod, self-contained on fresh replays, so the seed can never 23503 on a
   DB that has the dev-preview user but not the legacy category rows. §5 itself
   is `on conflict do nothing` against the active-name index, so an accidental
   re-apply is inert rather than fatal.
6. **Instance rows deliberately at 0.** The 63 instance rows seeded earlier on
   2026-07-31 were deleted the same day on the operator's direction (guarded
   data op; photos/usage/movements all verified 0 first). Units are born from
   picks, with real photos, as the field registers them.

## 3. Deliberately NOT in U1

- **No UI.** The catalog has no browse/manage surface yet and the `/equipment`
  add sheet still creates free-text instances that ignore the catalog — U2 is
  the unit that closes that gap, and until it lands, hand-adding instances is
  discouraged (they would carry a NULL SKU pointer to backfill).
- **No `db:types` regen** — deferred to U2 (the first unit with a TS consumer);
  regen only when live == main (another lane's `075886` was mid-flight at ship).
- Per-site demand planning (ต้องการ/ขาด columns of the sheet) — still out, same
  prove-value grounds as spec 367 §12; a future gap view now has its type grain.
- Import/export for the SKU catalog — 367's importer covers instances; extend
  only when the operator asks.

## 4. Units

- **U1 ✅ (this PR)** — schema + RLS/grants + seed + pgTAP
  (`385-equipment-catalog.test.sql`: shape, wall with positive control, live
  role-switched insert/read/refuse, expression-index bite).
- **U2 ✅ (2026-07-31) — pick-from-ทะเบียน add flow.** The `/equipment` add sheet
  leads with a SKU picker (grouped by the function categories); picking derives
  name (`<SKU> No.<n+1>` for unit-tracked, plain name + qty for bulk), category,
  brand/model and tracking SERVER-side (`createEquipmentFromCatalog`), and copies
  `default_daily_rate` → `daily_rate` through the existing audited
  `set_equipment_daily_rate` RPC after an admin-seam read. The พิมพ์เอง escape
  registers the SKU first (back-office only), so **`createEquipment` — the
  free-text instance writer — is DELETED**, not merely unwired (an exported
  server action is a live endpoint; U4's "retire free-text add" landed here).
  Decisions recorded from the U2 review:
  - **An orphan SKU is self-healing by design** — if the escape registers the
    SKU and the instance insert then fails, the SKU stays (it is real master
    data, pickable after refresh) and the error copy says exactly that.
  - **A failed rate copy or rate READ raises `rateWarning`**, never loses the
    row; the sheet freezes on the notice (the draftId is spent) instead of
    closing silently.
  - **The bulk one-row rule is ONE predicate on both sides** (any instance
    exists under the FK) — but it is app-code only; the DB-level partial unique
    index (`(equipment_catalog_item_id) where tracking='bulk'`) is **owed to
    U4** (schema), which also closes the concurrent same-SKU `No.<n>` collision
    (accepted v1: no unique on instance names).
  - The CSV importer (367 U3) keeps its documented free-text path until U4
    rules on it.
- **U3a ✅ (2026-07-31) — the ทะเบียน gets its own surface + the menu wording
  rethink.** Operator report, verbatim: _"now หมวดอุปกรณ์ and ทะเบียนอุปกรณ์ are
  mixed up to อุปกรณ์ item"_ + _"rethink of the wordings in menu"_. NEW
  `/equipment/catalog` (BACK_OFFICE_ROLES): SKU rows grouped by the function
  categories with per-SKU instance counts, rename/recategorise/brand/model
  (plain RLS on the granted columns), deactivate/reactivate (`is_active` — the
  active-name index frees a deactivated name, so reactivation can 23505; named
  message), register-new-SKU, and the **category quick-add moved here** (a
  category is a property of the TYPE; `/equipment` keeps its filter chips but
  loses the curation door). Menu vocabulary (labels.ts SSOT):
  **ทะเบียนเครื่องมือ** (the catalog) · **อุปกรณ์ (รายเครื่อง)** (the per-unit
  page) · **หมวดเครื่องมือ** (categories) — hub group relabelled
  **เครื่องมือ · อุปกรณ์** (the rental deal recorder is money, not master data;
  the เช่า entry returns when 361 U1 lands). Hub + /settings both carry the
  three-door split; NO money renders on the catalog surface.
- **U3b ✅ (2026-07-31) — the rate editor.** Mig `20260813075890`:
  `set_equipment_catalog_default_rate(uuid, numeric)` DEFINER — gate DELEGATES
  to `is_back_office()` (the twin item-RPC predates that lesson and restates
  the array), ≥0 validation, `equipment_rate_change` audit row with
  `target_table='equipment_catalog_items'` + payload kind
  `default_rate_change` (the 381 item-history reader filters by target_table,
  verified live, so catalog events never appear in a unit's history). Function
  EXECUTE revoked from public/anon, granted to authenticated. Surface:
  `SetCatalogDefaultRate` on each SKU row; the page admin-reads the rate map
  for its whole audience (the catalog page is BACK_OFFICE_ROLES-only, unlike
  /equipment where site_admin shares). Setting a default affects FUTURE picks
  only. pgTAP `385b-equipment-catalog-rate.test.sql` (9 asserts incl. both
  role arms + the audit-trail equality); the U3a source pin now allows exactly
  the admin seam's two mentions of the walled column.
- **U4 — tighten**: backfill any straggler instances, `equipment_catalog_item_id`
  → NOT NULL, decide `equipment_items.category_id` retirement, the bulk
  partial-unique index (from U2's review), the importer ruling, and **the
  rename-reconciliation policy** (U3a review find: renaming a SKU leaves
  existing units stencilled `<old> No.<n>` while new units mint
  `<new> No.<n+1>` — numbering stays unique, family identity does not; decide
  cascade-rename vs leave-and-note).

## 5. Verification

- pgTAP `385-equipment-catalog.test.sql` (16 asserts — shape ×5, wall ×6 incl.
  positive control + no-DELETE posture, role-switched behaviour ×5 incl. the
  technician read-EXCLUSION). First run red-first proved the runner's
  plan-mismatch gate (planned 14, ran 13); fixed by adding the three review
  asserts, not by editing the plan down.
- Live post-apply: head `20260813075887` · 39 SKUs · 11 categories used ·
  0 unpriced · 0 instances · wall probe `default_daily_rate`=refused with
  `name`=readable control.
- Fill-rate acceptance for U2 (when it lands): every new `equipment_items` row
  carries `equipment_catalog_item_id` — `count(*) filter (where
equipment_catalog_item_id is null)` stays 0 among rows created after U2 ships.
