# Spec 361 — procurement master-data hub (ข้อมูลหลัก) + rental catalog

**Status:** in progress (2026-07-26)
**Origin:** operator, 2026-07-26 — _"procurement manager requested to see rental
details, accounting also needs to know, there is no information to input, do we
have rental catalog similar to materials?"_, then _"Go, procurement manager can
edit catalogs full CRUD. I think we should group catalog settings for her, like
materials/staffs on-site/rentals/other expenses/(did I miss something?)"_.

Two asks in one: (a) rentals have no item dimension at all — build one; (b) the
firm's reference lists are scattered, half-built, and some are editable only via
SQL — group them behind one door that procurement_manager fully owns.

## 1. Live evidence (2026-07-26, service-role reads against the linked DB)

### 1.1 Rentals record WHO and HOW MUCH, never WHAT

`equipment_rental_batches` (29 rows) carries `supplier_id · monthly_rate ·
rate_period · deposit_amount · min_rental_days · starts_on/ends_on · status ·
note`. There is **no item column**, and `rental-deal-form.tsx` renders no item
field. The "what" survives only in free-text `note`:

| note (verbatim)         | rate           | supplier        |
| ----------------------- | -------------- | --------------- |
| `เช่ารถแม็คโคร PC 140`  | 11,000 ต่อวัน  | พจนารถ มาลัยศรี |
| `รถ6ล้อดั้ม`            | 3,000 ต่อวัน   | พจนารถ มาลัยศรี |
| `เช่ารถเครน ยกคอนกรีต`  | 7,760 ต่อวัน   | นายอุดร พะเทศ   |
| `เช่าห้องพัก`           | 2,500 ต่อเดือน | เกสา นิลมาลา    |
| `(ว่าง)` — several rows | 2,500 ต่อเดือน | เกสา นิลมาลา    |

Downstream, both requesters see nothing:

- **Accounting.** Every rental journal entry's memo is the literal string
  `Equipment rental` — `select memo, count(*) … where source_table =
'equipment_rental_batches' group by memo` returns exactly one row,
  `Equipment rental × 30`. There is no `/accounting/rentals` register —
  `/accounting` has billings · journal · ledger · payables · periods · projects ·
  purchases · retention · review · wht, and rentals appear only as an anonymous
  `Dr 1400 / Cr 2100(supplier)` pair.
- **Procurement manager.** The rental card shows supplier + rate + whatever note
  was typed. "How much did we spend on excavators", "what did a PC140 cost us
  last time" are unanswerable.

### 1.2 The taxonomy for it already exists and is empty

`equipment_categories` (9 rows) already contains **`รถขุด` and `รถหกล้อ` with
zero items** — someone started the rental taxonomy and nothing feeds it. The
other 7 categories hold the 63 `equipment_items`, which are PRC-**owned** hand
tools (กบไฟฟ้า, เครื่องเจาะดูดฝุ่นคอนกรีต, เครื่องเชื่อมไฟฟ้า…).

`equipment_items.rental_agreement_id` (FK → `equipment_rental_batches`) exists in
the schema, is used by **0 rows**, and is written by **0 code** (`grep` over
`src/` and `worker/` outside the generated `database.types.ts` returns nothing;
its only other mentions are its own migration and a `has_column` assertion in
`supabase/tests/database/268-equipment-rental-rate-period.test.sql:69`). It is a
dead column, not a usable link — and it is pinned, so this spec leaves it in
place rather than dropping it. `equipment_usage_logs` is likewise empty (0 rows).

### 1.3 The full reference-data inventory, and who may write it

| List                    | Table (rows)                                                                         | Write path today                                                                                                                                                                                                                                                                                                                                                                              | Verdict            |
| ----------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| วัสดุ                   | `catalog_items` 594                                                                  | `/catalog`, BACK_OFFICE_ROLES ✅                                                                                                                                                                                                                                                                                                                                                              | ok                 |
| หมวดวัสดุ / หมวดย่อย    | `catalog_categories` 15 / `..._sub` 1                                                | `/catalog`, BACK_OFFICE_ROLES ✅                                                                                                                                                                                                                                                                                                                                                              | ok                 |
| ราคาขายวัสดุ            | `item_sell_rates` / `sell_rate_table` 4                                              | `setItemSellRate`, super_admin + project_director 🔒                                                                                                                                                                                                                                                                                                                                          | leave exec-only    |
| อุปกรณ์ (ทะเบียนทรัพย์) | `equipment_items` 63                                                                 | `/equipment`, BACK_OFFICE_ROLES ✅                                                                                                                                                                                                                                                                                                                                                            | ok                 |
| หมวดอุปกรณ์             | `equipment_categories` 9                                                             | **create only in the UI** — `createEquipmentCategory` has no sibling. The DB is ahead: an `equipment_categories update by back office` policy already admits her, so rename needs no migration; deactivate does (no `is_active` column)                                                                                                                                                       | **U6**             |
| **เช่า**                | —                                                                                    | **does not exist**                                                                                                                                                                                                                                                                                                                                                                            | **U1–U3**          |
| **ค่าใช้จ่ายอื่น**      | `office_expense_categories` 8                                                        | **read-only** — SELECT is the only policy; no RPC, no UI                                                                                                                                                                                                                                                                                                                                      | **U5**             |
| ค่าแรงมาตรฐาน           | `worker_level_rates` 4 + WHT config                                                  | `/settings/labor-rates`, procurement_manager + super ✅                                                                                                                                                                                                                                                                                                                                       | ok                 |
| **สายงาน / หมวดงาน**    | `work_categories` 52                                                                 | RPCs exist, **zero callers**, and gate on `project_manager · super_admin · project_director` — **procurement_manager is refused**                                                                                                                                                                                                                                                             | **U7**             |
| หน่วยนับ                | `catalog_units` **25** (managed, spec 223 / ADR 0066) + free text on `catalog_items` | The picker + the three DEFINER RPCs (`create/update/set_catalog_unit_active`) **already exist and already admit procurement_manager** — but the RPCs have **zero callers**, so nobody can curate the list in-app. The `อื่น ๆ (ระบุเอง)` escape hatch (retained by 223) leaks: **18 of the 39 distinct strings are off-list, on 33 of 594 items (5.6%)**, incl. `ปิีป` (typo of ปี๊บ, 1 item) | **U8 (code-only)** |
| ผู้ขาย / ผู้ให้เช่า     | `suppliers` 54                                                                       | `/contacts/vendors` ✅                                                                                                                                                                                                                                                                                                                                                                        | ok                 |
| ผู้รับเหมาช่วง          | subcon contacts                                                                      | `/contacts/subcontractors` ✅                                                                                                                                                                                                                                                                                                                                                                 | ok                 |
| แม่แบบ BOQ / แผนจัดหา   | `supply_plans where is_template` (NOT `wp_templates` — retired 2026-07-27)           | `/settings/ordering-templates` ✅                                                                                                                                                                                                                                                                                                                                                             | ok                 |
| ประเภทเอกสารบริษัท      | doc types 35                                                                         | super_admin only, deliberately (spec 331 anti-redundancy) 🔒                                                                                                                                                                                                                                                                                                                                  | leave              |
| อัตรา WHT               | `wht_rates` 6                                                                        | accounting 🔒                                                                                                                                                                                                                                                                                                                                                                                 | leave              |

Expense-category usage confirms the list is real but stale: 4 of 8 categories
carry expenses (น้ำมัน/ค่าเดินทาง 11 · ทางด่วน/ที่จอดรถ 2 · อื่นๆ 2 ·
ค่ารับรอง/อาหาร 2), 4 have never been used, and nobody can add the ones that are
actually missing.

## 2. Decisions

**D1 — rentals get a CATALOG, not just a text field.** The cheap fix (a
`title` column on the batch) was considered and rejected: it re-creates the
free-text drift §1.3 already shows in `unit`, and gives no rate history. A rental
deal picks a catalog row and adds a per-deal `detail` (plate/serial: `PC140
ทะเบียน 82-1234`).

**D2 — its own table `rental_catalog_items`, NOT `catalog_items` and NOT
`equipment_items`.**

- `catalog_items` carries stock semantics — `product_code`, `unit`, `stockable`,
  on-hand ledger, **13 external inbound FKs** (`boq_line`,
  `catalog_assembly_components`, `catalog_item_categories`, `item_sell_rates`,
  `purchase_requests`, `stock_counts/issues/on_hand/receipts/returns/reversals`,
  `supply_plan_lines`) plus the self-FK `merged_into`. A rented crane is
  never received into a store, issued, counted, or reversed. Folding it in would
  put non-stock rows in front of every store/PR picker.
- `equipment_items` is the **owned-asset** registry: `asset_tag`, `status`,
  `tracking`, movements, `acquisition_cost`. Its `rental_agreement_id` (§1.2) is
  a dead column, and reusing it would mean minting a fake asset row per rental
  deal.
- The new table is small (name · category · default rate + period · usual
  supplier · note · is_active) and shares the **existing** `equipment_categories`
  tree — no fourth taxonomy (the three in `catalog-category-model-2026-07` stand).

**D3 — the hub is a section on `/procurement`, her home since spec 323 U4**,
not a new `/settings` section: master-data doors deliberately left her ตั้งค่า in
that spec. Roles that still use `/settings` (PM, super_admin) keep reaching the
same doors from ข้อมูลหลัก there — the hub adds a grouped door, it moves no
existing one.

**D4 — full CRUD for procurement_manager, with two carve-outs that stay.**
Operator grant, verbatim: _"procurement manager can edit catalogs full CRUD"_.
Excluded, unchanged: **ราคาขาย** (super_admin + project_director — a selling
price, not a catalog fact) and **ประเภทเอกสารบริษัท** (super_admin, spec 331's
anti-redundancy control point). Both are money/governance decisions, not
reference data. WHT rates stay accounting's.

**D5 — TOP-LEVEL work-category codes are immutable; sub-codes are editable.**
The stronger rule ("codes never change") was drafted and then refuted:
**nothing FKs on `work_categories.code`** — all four referrers
(`work_category_material_categories`, `boq_line`, `project_categories`,
`worker_trades`) FK the uuid PK — and spec 336 D4 states outright that the
งานย่อย code is a _suggestion_, with no DB constraint tying a code to its
category. So a rename orphans nothing; it only desynchronises prefixes already
printed on existing WPs.

One real hazard survives, and it is narrow: `src/lib/work-categories/identity.ts`
resolves the identity letter/icon/colour from `left(code, 3)` against a
**hard-coded** `WORK_CATEGORY_TOP_CODES` list and returns `null` for anything
outside it (spec 277). Renaming `W03` to `W3` therefore silently strips a
category's identity app-wide. Rule: the CRUD UI **locks `code` for top-level
(3-char) categories**, allows it on sub-categories, and warns on any code edit
that existing WP codes keep the prefix they were minted with.

**D6 — units already have a managed list; U8 builds the missing UI, not a table.**
The first draft proposed a new `units_of_measure`; the fact-check refuted it —
`catalog_units` (25 rows, spec 223 / ADR 0066) exists, the catalog item form
already picks from it (`catalog-item-form.tsx`, `src/lib/purchasing/units.ts`),
and `create_catalog_unit` / `update_catalog_unit` / `set_catalog_unit_active`
already gate on a set that **includes procurement_manager**. The actual gaps are
(a) those RPCs have zero callers, so the list is uncurable in-app, and (b) the
deliberate `อื่น ๆ (ระบุเอง)` escape hatch leaks 18 off-list strings onto 33
items. U8 = a curation UI over the existing RPCs + folding the off-list strings
into the managed list. **No new table, no migration, and `catalog_items.unit`
stays `text`** — converting it to an FK is a rewrite of the store/PR/plan/report
read paths with no user-visible gain. Whether the escape hatch survives is an
open question, not a decision (§4.4).

**D7 — expense categories may name a GL account; they are not required to.**
The first draft made `gl_account_code` mandatory on create, reasoning that a
category without one posts nowhere. Live evidence refutes the premise: **all 8
rows have `gl_account_code = NULL`**, no function and no application code reads
the column, and `office_expenses` posts **no journal entries at all**
(`count(*) from journal_entries where source_table='office_expenses'` = 0). A
mandatory picker would make new categories stricter than every existing one for
a pipeline that does not exist yet. U5 offers the GL account as an **optional**
field, sourced from the chart of accounts (never free text), so the column is
ready when office-expense posting is built.

**D8 — the rental item name reaches the ledger.** `post_rental_batch_to_gl`
writes memo `Equipment rental` for every entry. It becomes
`เช่า<item> · <supplier>` (falling back to the current literal when a legacy
batch has no catalog item), which is what makes the accounting ask answerable
without a new report.

## 3. Units

Each unit is one PR through `scripts/ship-pr.sh`. Schema lane is queued behind
`075855` (360bounce) and `075856` (pmgrmembers) — this lane's first migration is
**`075857`**. ⚠️ `075856` exists as a file on `pmgr-project-members`, but
`075855` is a LANES **reservation only** (no file on any ref; live head is
`075854`) — confirm with that lane before U1, or `075857` leaves a permanent
numbering hole.

| Unit   | What                                                                                                                                                                                                                                                                                                                                                                                                                                        | Schema                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **U1** | `rental_catalog_items` + RLS + DEFINER CRUD RPCs (BACK_OFFICE gate, mirroring `create_catalog_category`) · `equipment_rental_batches.rental_catalog_item_id` + `detail` · `create_equipment_rental_batch` widened by 2 trailing defaulted params — ⚠️ `create or replace` with extra params creates a **second overload**; the live 9-arg version must be `drop function`-ed in the same migration or PostgREST sees an ambiguous signature | mig `075857`               |
| **U2** | Deal form: เช่าอะไร picker (grouped by `equipment_categories`, quick-add for a new item) + รายละเอียด detail field; rental cards + `/equipment/rentals` + `/projects/:id/rentals` render the item                                                                                                                                                                                                                                           | code only                  |
| **U3** | GL memo carries the item (D8) + `/accounting/rentals` register (deal · supplier · item · period · charged · settled · WHT)                                                                                                                                                                                                                                                                                                                  | mig (re-create the poster) |
| **U4** | `/procurement/master-data` hub — grouped doors with live counts: วัสดุ · หมวดวัสดุ · เช่า · อุปกรณ์ · หมวดอุปกรณ์ · สายงาน · หน่วยนับ · ค่าใช้จ่าย · ค่าแรงมาตรฐาน · ผู้ขาย · ผู้รับเหมาช่วง · แม่แบบ                                                                                                                                                                                                                                       | code only                  |
| **U5** | Expense-category CRUD: INSERT/UPDATE via DEFINER RPCs (procurement tier + accounting), optional GL-account picker (D7), deactivate not delete                                                                                                                                                                                                                                                                                               | mig                        |
| **U6** | Equipment categories: rename (UI only — the UPDATE policy already admits her) + deactivate (`is_active` column, absent today)                                                                                                                                                                                                                                                                                                               | mig (`is_active` only)     |
| **U7** | Work-category CRUD UI on the existing RPCs + widen their gate to `procurement_manager` (operator ruling 2026-07-26); top-level `code` locked (D5)                                                                                                                                                                                                                                                                                           | mig (re-create 3 RPCs)     |
| **U8** | Curation UI over the **existing** `create/update/set_catalog_unit_active` RPCs + fold the 18 off-list strings into `catalog_units` (operator-reviewed list)                                                                                                                                                                                                                                                                                 | **code only** (D6)         |

**Order:** U1 → U2 → U3 (closes the two requests that opened this spec) → U4
(frames the rest) → U5 → U6 → U7 → U8.

## 4. Open questions

1. **Rental catalog seeding.** U1 ships the table empty; the 29 live batches'
   notes suggest ~6 real items (รถแม็คโคร PC140 · รถ6ล้อดั้ม · รถเครน ·
   ห้องพัก · …). Back-filling `rental_catalog_item_id` onto historical batches is
   NOT in U1 — the batch row is money-posted, so a back-fill is its own reviewed
   data op. Proposed after U2, once the operator confirms the item list.
2. **Unit fold-in list.** U8 needs the operator's ruling on which of the **18
   off-list** strings become managed `catalog_units` rows and which are typos to
   retire (`ปิีป`→`ปี๊บ` is certain; `เที่ยว`, which is live on real items, is a
   judgement call about haulage billing).
3. **Deposit leg.** `createRentalBatch` still never sends `p_deposit_paid_date`,
   so the `rental_deposits` GL leg stays latent (memory
   `equipment-rental-gl-delete-lesson`). Out of scope here; flagged.
4. **Does the `อื่น ๆ (ระบุเอง)` unit escape hatch survive U8?** Spec 223
   retained it deliberately. With a curation UI in place, "add the unit, then
   pick it" becomes a real path, so the hatch could close — but only the operator
   knows whether field-side entry needs it. U8 ships the curation UI either way
   and does not silently remove the hatch.
5. **pgTAP filename collision.** Lane `pmgr-project-members` has already created
   `supabase/tests/database/361-project-members-pmgr.test.sql` without claiming
   spec number 361 (its lane note points at spec 330). No hard conflict — this
   spec's tests will carry their own names — but after both merge, two unrelated
   features share a `361-` prefix. Worth a rename on their side.

## 5. Non-goals

- No per-machine tracking, no rental usage logs, no return/utilisation flow —
  `equipment_usage_logs` stays empty and untouched.
- No change to `catalog_items.unit`'s type (D6), to the three existing taxonomies,
  or to sell rates / WHT / company doc types (D4).
- No new role and no change to `BACK_OFFICE_ROLES` membership.
