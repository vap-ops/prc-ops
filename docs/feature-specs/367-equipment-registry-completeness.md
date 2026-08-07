# Spec 367 — Equipment registry completeness + bulk import/export

**Status:** spec written 2026-07-27. **U0 ✅ shipped.** ▶ U1 (schema).
**Origin:** operator directive 2026-07-27, three asks in one message:

> 1. Figure out the difference in data fields, check what are missing (images are missing for sure, what else)
> 2. Add an import/export features on both list (consider templates to fill in data)
> 3. Keep in mind we will export all equipments to PRI, a sister company, then we rent back the whole store.

The session that produced this spec started from a different question — _"how do I see all the equipments in the store?"_ — whose answer is §1.1 and is the reason the operator asked (1)–(3).

---

## 1. Live grounding (queried 2026-07-27, prod)

### 1.1 Why nothing appears "at the store"

`equipment_items` holds **64 rows**. `equipment_movements` holds **1 row, total**.

Location on `/equipment` is derived purely from the latest movement per item
(`src/lib/equipment/current-location.ts` → `equipment-location-label.ts`), so **63
of 64 items render `—`**. Nothing was ever recorded as `รับเข้าคลัง`. Status split
is `available=63 / on_site=1`.

The registry is not in the wrong place — the operator's hypothesis was that
equipment had been registered under ทะเบียนเช่าอุปกรณ์. It has not:
`equipment_rental_batches` (29 rows) is the **inbound rental agreement** list
(rented rooms, a rented tractor), and it carries **no item dimension at all**
(spec 361 §"Rental model"). Zero equipment lives there.

⚠️ A contributing cause of the confusion is a **stale label**: the ข้อมูลหลัก
settings card for `/equipment` reads `label: "อุปกรณ์"` with
`hint: "ทะเบียนอุปกรณ์เช่า"` (`src/app/settings/sections.ts`), which describes a
rental registry. The registry actually holds 64 company-owned hand tools. Fix
lands in U0.

### 1.2 Fill rate — what is actually populated

| Column                | Fill (of 64) | Note                                                                                                                  |
| --------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `name`                | 64           | brand + model + serial are **crammed into this free text** — e.g. `เครื่องทดสอบรอยรั่ว  ยี่ห้อ ASADA TEST PUMP TP50E` |
| `category_id`         | 64           | 9 categories; **4 items sat under `งานวัสดุพื้นฐานโครงสร้าง`** — see §1.4, fixed in U0                                |
| `owner_id`            | 64           | `equipment_owners` = **1 row**, `Prestion Construction Co., Ltd.`                                                     |
| `supplier_id`         | 64           | **all 64 point at PRC itself** — a second owner axis, misused                                                         |
| `status`              | 64           | enum `available, on_site, in_use, maintenance, returned, lost`                                                        |
| `tracking`            | 64           | enum `unit, bulk`                                                                                                     |
| `asset_tag`           | **5**        |                                                                                                                       |
| `quantity`            | **9**        |                                                                                                                       |
| `acquisition_cost`    | **0**        |                                                                                                                       |
| `acquired_at`         | **0**        |                                                                                                                       |
| `daily_rate`          | **0**        |                                                                                                                       |
| `rental_agreement_id` | **0**        | DEAD column — 0 rows, 0 callers, pinned by `268-equipment-rental-rate-period.test.sql` (do not drop)                  |

Category spread (post-U0): เครื่องมือช่างทั่วไป 44 · เครื่องวัด 8 · เครื่องจักรก่อสร้าง 4 ·
เครื่องมือเจาะ 4 · เครื่องสูบน้ำและอุปกรณ์ระบายน้ำ 2 · เครื่องเทส 1 · Safety 1.

### 1.3 Fields that do not exist at all

| Missing                        | Consequence                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **image**                      | ✓ operator's guess. `catalog_items` has `image_path` + private bucket `catalog-images` + `catalog-image-control.tsx`; equipment has **none of the three**                                                 |
| **brand / model / serial no.** | no per-asset identification — the PRI transfer schedule (§3) needs it, and today it is free text inside `name`                                                                                            |
| **condition**                  | no grade. Selling used assets needs one; so does handover-back on the rent-back                                                                                                                           |
| **description / spec**         | `catalog_items` has `note` + `spec_attrs`; `equipment_items` has no free-text field at all                                                                                                                |
| **book value / depreciation**  | `acquisition_cost` + `acquired_at` exist but are **0/64**, and there is no useful-life, no accumulated depreciation, no disposal record ⇒ **no way to price the PRI sale**                                |
| **disposal state**             | `equipment_status` has no `disposed` / `transferred` — an item sold to PRI has nowhere to go                                                                                                              |
| **home location**              | location is derived from movements only; there is no default/home field, and no store entity for equipment (the store `/projects/[id]/store` is _material_ stock — `catalog_items`, a different taxonomy) |
| **PM / warranty**              | no next-service date. **Out of scope** — recorded, not built                                                                                                                                              |

### 1.4 The `งานวัสดุพื้นฐานโครงสร้าง` category — CORRECTED, then fixed (U0, 2026-07-27)

The spec first claimed this was "a _material_ work-category that leaked into the
equipment taxonomy". **That was wrong** and was corrected before U0 acted on it:
`ilike '%วัสดุพื้นฐาน%'` returns **zero rows** in both `work_categories` and
`catalog_categories`. Nothing leaked — the name was typed straight into
`equipment_categories`.

Its 4 members are all engine-powered construction plant:
เครื่องขัดมันพื้นปูน MARTON 6.5 แรงม้า · เครื่องดัดเหล็กเส้น Rebar Bender XYLON ·
เครื่องตบดิน MARTON · โม่ผสมปูนฉาก.

**Operator ruling 2026-07-27: they are equipment** (option "First" of §10 Q2). So
the fix is not to move 4 items into a foreign category — it is to rename the
container that already groups them correctly but describes them wrongly:

```
งานวัสดุพื้นฐานโครงสร้าง → เครื่องจักรก่อสร้าง
```

Applied as a data op, `equipment_categories.id = ac49d5cf-06f7-4e43-963d-58d36763f429`.
**Rollback value: `งานวัสดุพื้นฐานโครงสร้าง`.** Verified after: all 4 items still
attached, all other category counts unchanged (44 · 8 · 4 · 4 · 2 · 1 · 1 · 0 · 0).

ⓘ No migration — `equipment_categories.name` is operator-owned data with a
column-scoped UPDATE grant and a rename UI already shipped (spec 361 U6). Nothing
in the codebase keys on this name, so no test pins it (and per
[[prc-ops-db-migration-lessons]], asserting equality on a value a human may edit
is exactly the pgTAP anti-pattern that ejects other lanes from the merge queue).

### 1.5 Rental list gaps

`equipment_rental_batches`: `owner_id · supplier_id · monthly_rate · rate_period
(monthly|daily) · starts_on · ends_on · min_rental_days · deposit_amount ·
deposit_paid_date · status (active|returned|settled|cancelled) · note`.

Missing: **any item dimension**, quantity, per-item rate, images. The "what" lives
in free-text `note`, **blank on 20 of 29**. All 30 rental journal entries carry the
memo `Equipment rental` verbatim (spec 361).

---

## 2. Decision D1 — ONE registry, not two (operator ruling 2026-07-27: "Rec")

The operator was offered:

- **A** — keep `equipment_items` as the single asset registry. On the PRI transfer,
  flip ownership to PRI and revive the dead `equipment_items.rental_agreement_id`
  to bind the whole set to one PRI master agreement; per-item `daily_rate` becomes
  the rent-back rate.
- **B** — build spec 361 U1's separate `rental_catalog_items` table and let the
  equipment registry go historical.

**Ruling: A.** B would duplicate all 64 rows, because after the PRI move the things
PRC rents _are these same items_.

### 2.1 Consequence for spec 361 U1 (queued, not yet built)

Spec 361 U1 planned `rental_catalog_items` as the item dimension for
`equipment_rental_batches`. Under D1 that table is **re-aimed to external rentals
only** — plant PRC does not and will not own (รถแม็คโคร, รถหกล้อ, ห้องพัก). Rentals
of PRC's own former assets resolve through `rental_agreement_id` on
`equipment_items` instead.

⚠️ This spec does **not** cancel spec 361 U1. It narrows its scope. The two item
sources must both be readable by the U3 rentals surface — recorded as an open
question in §7, **not** designed here.

---

## 3. The PRI transfer (context, mostly NOT built here)

PRC sells all equipment to PRI (sister company), then rents the whole store back.
That is a real transaction requiring, per asset: **acquisition cost, acquired date,
serial, condition, and a book value at transfer date** to price the sale — every
one of which is `0/64` or absent today (§1.2, §1.3).

So the import/export in this spec is not a convenience: it is the only realistic way
to load ~64 × 6 missing values from a cloud PC, and **the export IS the transfer
schedule**. That is why §1's gaps are fixed _before_ the exporter ships.

**Not built in this spec** (own spec, after the fields exist and are filled):
the ownership flip, the master rental agreement, the GL treatment of the asset
disposal and the inbound rent expense. §4's `disposed` status and the revived
`rental_agreement_id` are the seams that spec will use; nothing more.

---

## 4. Schema (U1)

All additive. Column names gate-checked against `src/lib/db/database.types.ts` —
`brand`, `model`, `serial`, `condition`, `book_value`, `useful_life`, `disposed`
appear **nowhere** in the current schema; `image_path` (3 uses) and `description`
(15 uses) are established names and are reused verbatim.

On `public.equipment_items`, all nullable:

| Column        | Type                         | Why                                                                                                         |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `brand`       | `text`                       | today inside `name`                                                                                         |
| `model`       | `text`                       | today inside `name`                                                                                         |
| `serial_no`   | `text`                       | per-asset identity for the transfer schedule (`invoice_no` in `rental_settlements` is the naming precedent) |
| `condition`   | `public.equipment_condition` | NEW enum — see below                                                                                        |
| `description` | `text`                       | free-text spec; matches the 15 existing `description` columns                                               |
| `image_path`  | `text`                       | storage object path; matches `catalog_items.image_path`                                                     |

New enum `public.equipment_condition`: `new · good · fair · needs_repair`.
Thai labels go in `src/lib/i18n/labels.ts` as `EQUIPMENT_CONDITION_LABEL`
(a `Record<Enums["equipment_condition"], string>`, so an enum-add trips
exhaustiveness on purpose).

New value on `public.equipment_status`: **`disposed`**.
⚠️ Adding an enum value trips exhaustiveness guards deliberately. Two named
guards, both to be updated in the same unit and never weakened:

- `supabase/tests/database/65-equipment-registry.test.sql:33` —
  `enum_has_labels('public','equipment_status', ARRAY['available','on_site','in_use','maintenance','returned','lost'])`.
  This **will red** on the new value; add `disposed` to the array.
- `STATUS_LABELS` in `src/components/features/equipment/equipment-manager.tsx:86`
  — a `Record<EquipmentStatus, string>`, so typecheck reds until `disposed` has
  a label.

### 4.1 Label SSOT promotion (part of U1, required by U3)

⚠️ Corrected against live source while writing this spec: **there is no
`EQUIPMENT_STATUS_LABEL` in `labels.ts`.** Equipment labels are split —
`EQUIPMENT_MOVEMENT_KIND_LABEL`, `EQUIPMENT_RATE_PERIOD_LABEL` and the
`EQUIPMENT_*` strings live in `src/lib/i18n/labels.ts`, but the **status map
(`STATUS_LABELS`, line 86) and the tracking options (`unit`/`bulk`, lines
108–109) are local consts inside `equipment-manager.tsx`.**

§6's importer maps Thai label → enum value and cannot import from a component,
so U1 **promotes both into `labels.ts`** as
`EQUIPMENT_STATUS_LABEL: Record<Enums["equipment_status"], string>` and
`EQUIPMENT_TRACKING_LABEL: Record<Enums["equipment_tracking"], string>`, with
`equipment-manager.tsx` re-pointed at them. This is the
[[ui-term-consistency-ssot]] rule (any user-facing term used in 2+ places is
single-sourced) — the importer is the second place.

ⓘ Noted, not fixed: `EQUIPMENT_RATE_PERIOD_LABEL` is typed
`Record<"monthly" | "daily", string>` — a hand-written union, not
`Enums["equipment_rate_period"]` — so an enum-add would **not** trip it. U4 reads
this map; re-typing it to the generated enum is a one-line hardening inside U4.

New private bucket **`equipment-images`**, policies mirrored from `catalog-images`.
⚠️ Parity sweeps that scan only `public` MISS `storage.objects` policies
([[delivery-photo-storage-rls-fix-2026-07]]) — the storage policy is part of U1,
with its own pgTAP.

**Not added** (recorded, deliberately deferred): `useful_life`, accumulated
depreciation, `home_location_id`, next-service date. Book value is **derived at
export time** from `acquisition_cost` + `acquired_at` once those are filled; a
stored `book_value` column would immediately go stale and is a decision for the
PRI-transfer spec, not this one.

---

### 4.2 ⚠️ `equipment_items` is COLUMN-GRANTED — the new columns need explicit grants

Found at U1 gate-check, **not** in the original draft of this spec. Live
`information_schema.column_privileges` for `authenticated`:

| Privilege | Columns granted                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SELECT    | `asset_tag, category_id, created_at, created_by, id, name, owner_id, quantity, rental_agreement_id, status, supplier_id, tracking` |
| INSERT    | same, minus `created_at`                                                                                                           |
| UPDATE    | `asset_tag, category_id, name, owner_id, quantity, rental_agreement_id, status, supplier_id, tracking`                             |

**`acquisition_cost`, `acquired_at` and `daily_rate` are deliberately absent** —
ADR 0055 decision 6 (money is zero-authenticated-grant, read only through the admin
client after the `canManageRegistry` gate). That wall is real and must not be
widened.

But it means a new column is **invisible to the RLS client until granted**. Adding
one to the page's `select(...)` without a grant does not yield null — PostgREST
refuses the read outright (the `worker_level_rates` precedent,
[[spec361-master-data-hub]]). So U1 must grant `select, insert, update` on the six
new columns to `authenticated`: they are **not** money and take non-money parity.

RLS itself needs **no change** — the table's three policies already carry the right
audiences and are already `(select current_user_role())`-wrapped: SELECT admits
`site_admin` + the five back-office roles, INSERT/UPDATE admit the five back-office
roles only (matching `canManageRegistry`). pgTAP pins the grants in both
directions: the six readable by `authenticated`, the three money columns still
refused.

### 4.3 The `equipment-images` bucket mirrors STRUCTURE, not `catalog-images`' role list

`catalog-images` has exactly **one** policy — bucket-scoped `INSERT` for
`authenticated` — and **no SELECT policy at all**; reads go through server-minted
signed URLs (`src/lib/storage/signed-urls.ts`). U1 mirrors that shape.

⚠️ It does **not** mirror the role list. `catalog-images`' INSERT names four roles
(`project_manager, super_admin, procurement, project_director`) and **omits
`procurement_manager`**, who _can_ create equipment items (the `equipment_items`
INSERT policy admits five). Copying the four verbatim would ship
affordance-then-refuse: she creates the item, then the upload 42501s — the exact
middle-layer mismatch the doctrine's three-layer rule names. The equipment bucket
therefore takes the **`equipment_items` INSERT role set**, and a pgTAP case pins
that the two agree.

ⓘ Recorded here, FIXED 2026-07-28 outside this spec: `catalog-images` was missing
`procurement_manager` — the same latent bug on the _materials_ side — and she hit
it in the field. Migration `20260813075866` repointed that policy at
`is_back_office` (and wrapped `current_user_role()` in a `select`, which it did not
do before), so the four-vs-five mismatch this section warns about no longer exists.

---

## 5. Export (U2)

Two exports, both reusing the house idiom from
`src/lib/purchasing/purchase-line-export.ts`: **Thai headers, UTF-8 BOM** so Excel
opens Thai clean, pure IO-free row→CSV module + a thin route handler.

⚠️ `next/link` on a route handler **executes it on prefetch** (spec 358 U4, proven
live) — the download control must be `<a download>`, never `<Link>`.

⚠️ This project's PostgREST `db-max-rows` is **1000** (spec 361). Both exporters
must page to exhaustion, not assume one page — 64 rows today, but a store-wide
transfer schedule is exactly the thing that grows.

**Equipment columns** (export shape == import template shape, so it round-trips):

```
รหัสอ้างอิง · ชื่อ · หมวดหมู่ · ยี่ห้อ · รุ่น · หมายเลขเครื่อง · ป้ายทรัพย์สิน ·
การติดตาม · จำนวน · สภาพ · สถานะ · เจ้าของ · ผู้ขาย · วันที่ได้มา · ราคาทุน ·
ค่าเช่า/วัน · ที่ตั้งปัจจุบัน · รายละเอียด · มีรูป
```

`ราคาทุน` and `ค่าเช่า/วัน` are **money** — `daily_rate` is zero-authenticated-grant
(ADR 0055 decision 6) and `/equipment` already reads it through the admin client
only for `canManageRegistry`. **The export route re-gates to `BACK_OFFICE_ROLES`
and the money columns are omitted entirely for any other audience** — a
`site_admin` export must not carry them. Pinned by test in both directions.

`ที่ตั้งปัจจุบัน` is the derived movement label, **read-only** — it is not importable
(location changes go through `equipment_movements`, never a spreadsheet).
`มีรูป` is likewise read-only (`ใช่`/`—`).

**Rental columns:**

```
รหัสอ้างอิง · ผู้ให้เช่า · ผู้ขาย · รายการ(หมายเหตุ) · อัตรา · หน่วยอัตรา ·
เริ่ม · สิ้นสุด · ขั้นต่ำ(วัน) · เงินมัดจำ · วันจ่ายมัดจำ · สถานะ
```

The whole rentals surface is already `BACK_OFFICE_ROLES`-gated, so no per-column
money split applies there.

---

## 6. Import (U3 equipment, U4 rentals)

Reuse `src/lib/wp-import/parse.ts`'s proven shape: **papaparse, IO-free, no DB
calls**, auto-detecting comma-CSV-with-header vs **tab-delimited Google-Sheets
paste** — the operator works from a cloud PC, and paste is the path that avoids a
file round-trip entirely. UI mirrors `import-work-packages-sheet.tsx` (a
`BottomSheet`), which is also the house idiom `/equipment` now uses after spec 362.

**Round-trip rule:** `รหัสอ้างอิง` blank ⇒ INSERT; filled ⇒ UPDATE that row.
An unrecognised id is an **error, not an insert**.

**Preview then commit.** The sheet shows counts (`เพิ่ม n · แก้ไข n · ผิดพลาด n`) and
every error with its row number before anything is written. No partial writes: the
commit is one transaction per import.

**Template download** is the export of the current list — so "fill in the missing
data" means export → fill columns → paste back. A separate empty-template file
would drift from the exporter; there is exactly one column contract.

Validation rules (all pure, all testable from crafted strings):

- `หมวดหมู่` / `เจ้าของ` / `ผู้ขาย` resolve **by name** against the existing rows;
  an unknown name is an error, **not** an auto-create (an importer that invents
  taxonomy rows is how the 4 mis-filed `งานวัสดุพื้นฐานโครงสร้าง` items happen again).
- `การติดตาม` / `สภาพ` / `สถานะ` / `หน่วยอัตรา` map Thai label → enum value via the
  `labels.ts` SSOT maps (§4.1 — two of the four do not live there yet and are
  promoted in U1), so a renamed label can never silently split the contract.
- money + `จำนวน` + dates parse strictly; **blank ≠ 0** (the
  `purchase-line-export` precedent: a blank stays blank, never a fake `0.00`).
- money columns are **rejected outright** when the importing session is not
  `BACK_OFFICE_ROLES` — the mirror of §5's export gate, enforced server-side.

---

## 7. Images (U5)

Per-item image upload on the `/equipment` row sheet, reusing
`src/components/features/catalog/catalog-image-control.tsx` against the new
`equipment-images` bucket and `src/lib/storage/buckets.ts`.

Images **cannot ride in CSV**. Bulk load is a separate follow-up (match uploaded
filenames against `serial_no` or `asset_tag`) and is **not** built here — U5 is the
single-item control only. Recorded so the gap is visible rather than assumed done.

---

## 8. Units

| Unit      | Scope                                                                                                                                                                                                                                                    | Schema?                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **U0** ✅ | Fix the stale `ทะเบียนอุปกรณ์เช่า` hint in `settings/sections.ts` (pinned both directions); rename `งานวัสดุพื้นฐานโครงสร้าง` → `เครื่องจักรก่อสร้าง` per §1.4                                                                                           | code + 1 data op        |
| **U1**    | Schema: 6 columns, `equipment_condition` enum, `equipment_status += disposed`, `equipment-images` bucket + storage policy; **plus the §4.1 label-SSOT promotion** and the two named guard updates (`65-equipment-registry.test.sql:33`, `STATUS_LABELS`) | ✅ mig `20260813075860` |
| **U2**    | Both exports (pure row→CSV modules + `<a download>` route handlers, money re-gate)                                                                                                                                                                       | —                       |
| **U3**    | Equipment importer (parse module + preview sheet + commit action)                                                                                                                                                                                        | —                       |
| **U4**    | Rental importer                                                                                                                                                                                                                                          | —                       |
| **U5**    | Per-item image control                                                                                                                                                                                                                                   | —                       |

U0 and U2 are independently shippable and unblock the operator immediately
(export the list → start filling it offline). U1 must land before U2 can export the
new columns, so the real order is **U0 → U1 → U2 → U3 → U4 → U5**.

---

## 9. Non-goals

- The PRI ownership flip, master rental agreement, disposal GL, rent-back expense
  posting (§3 — own spec).
- Depreciation schedules / useful life / stored book value (§4).
- Bulk image upload (§7).
- A "receive all 64 into คลัง" bulk movement action. ⚠️ **This is the operator's
  original question and it is NOT answered by this spec** — see §10.
- Any change to `/projects/[id]/store` (material stock, different taxonomy).
- Any re-gating. `/equipment` = `EQUIPMENT_MOVE_ROLES` with a `BACK_OFFICE_ROLES`
  money audience; `/equipment/rentals` = `BACK_OFFICE_ROLES`. Both carry across
  unchanged and get pinned.

---

## 10. 🔔 Open questions for the operator

1. ~~**Should an item with no movement read as "at คลัง" or "ยังไม่ระบุ"?**~~ **ANSWERED
   2026-08-07 by making the state unreachable instead of choosing a label: the add
   sheet asks `ตอนนี้อยู่ที่ไหน` (prefilled to คลัง per the store-first directive) and
   `createEquipmentFromCatalog` writes the matching `received`/`deployed` movement
   after the item insert.** So a newly registered item is never movement-less, the
   label never has to assert an unverified location, and no bulk backfill is owed —
   the registry is empty as of the 07-30 reset, so there is nothing to backfill.
   The `—` placeholder stays for pre-existing rows and for the failure arm
   (`locationWarning`), which names the ย้าย button as the fix rather than closing
   silently. Driver: the operator is handing the registry to the procurement team,
   so the defect would otherwise have been re-created once per unit entered.
   Superseded text: Unanswered
   from the original exchange. It decides whether 63 items need a one-off bulk
   `รับเข้าคลัง` movement (honest, needs a bulk action) or whether the label simply
   defaults (free, but asserts a location nobody verified). **Blocks nothing in
   U0–U5**, but it is the operator's actual first question and is still open.
2. ~~**Do the 4 items under `งานวัสดุพื้นฐานโครงสร้าง` belong in equipment at all?**~~ **ANSWERED 2026-07-27: they are equipment.** Fixed in U0 by renaming the category (§1.4). Superseded text:
   are they materials that should live in `catalog_items`? U0 assumes re-file
   within equipment; if they are materials, they need deleting instead.
3. ~~**Does PRI already exist as a row?**~~ **ANSWERED 2026-07-27: not yet — PRI has no record of any kind.** The transfer spec must create it, and must decide which axis it lands on, because `owner_id` and `supplier_id` both point at PRC today. Superseded text: **Does PRI already exist as a row** — as an `equipment_owners` entry, a
   `supplier`, or neither? The transfer spec needs one clear counterparty record,
   and today `owner_id` and `supplier_id` **both** point at PRC (§1.2), which is the
   modelling smell the transfer will force a decision on.
4. ⚠️ **Loading `acquisition_cost` / `daily_rate` / `acquired_at` BY CSV needs its
   own unit — and it is the one the PRI transfer actually depends on.** Found at
   U3 gate-check against the real write path, not assumed from this spec: none of
   the three carries an authenticated grant, `daily_rate` is writable only through
   the SECURITY DEFINER `set_equipment_daily_rate` RPC (where the gate and the
   audit row live), and **`acquisition_cost` has no write path in the app at
   all**. So U3's importer refuses a filled money cell rather than silently
   dropping it. All 64 rows are blank today, so the ordinary round trip works —
   but §3's whole premise is that these get filled, so the follow-up unit (a
   DEFINER RPC accepting cost + acquired-on, mirroring `set_equipment_daily_rate`)
   is **required before the PRI schedule can be produced**, not optional.
5. ~~**`catalog-images` is missing `procurement_manager`**~~ (§4.3) — **CLOSED
   2026-07-28.** The prediction held: she hit it in the field before the follow-up
   unit was written (the sheet showed only `อัปโหลดรูปไม่สำเร็จ`, so it had been
   silent). Migration `20260813075866` repointed the policy at `is_back_office`;
   pgTAP 122 now pins the delegation + the behaviour instead of the policy's name.
6. **Spec 361 U1 scope** — confirm the §2.1 narrowing (external rentals only)
   before that unit is built, so the two item sources are designed together.

---

## 11. Verification

Per-unit gates are the `ship-unit` skill's. Spec-level acceptance is a **fill-rate
query**, not a green suite — the feature's entire purpose is to make these columns
non-empty, and a zero fill after real use means dead on arrival regardless of tests:

```sql
select count(*) n,
       count(brand) brand, count(model) model, count(serial_no) serial_no,
       count(condition) condition, count(image_path) image_path,
       count(acquisition_cost) acq_cost, count(acquired_at) acq_at,
       count(daily_rate) daily_rate
from public.equipment_items;
```

Baseline 2026-07-27 = `64, 0, 0, 0, 0, 0, 0, 0, 0`. Run it after the operator's
first real import; a still-zero column means the template or the importer is not
being used for it.

---

## 12. Refill seed + หลักการตั้งหมวด (2026-07-31, prod data op — no migration)

Post-reset refill, from the operator's 2-branch tool sheet (61 types across
กกกระทอน + นายาว). Operator directives, 2026-07-31: the ทะเบียน stays in the same
menu group as ทะเบียนวัสดุ so the procurement manager completes setup in one place
(already true — the ข้อมูลหลัก hub's `เช่า · อุปกรณ์` group, spec 361 U4); the
registry is **seeded to assist her**, not typed from scratch; and _"the principle
behind categories must exist, so tuning in would be easy for users."_

### หลักการตั้งหมวด (the category principle)

**หมวด = ลักษณะงานที่เครื่องมือใช้ทำ (function-first).** ผู้ใช้คิดจากงานที่กำลังจะทำ
— ตัด → เครื่องมือตัดและเจียร, เจาะ → เครื่องมือเจาะและสกัด — แล้วเจอเครื่องมือทันที
โดยไม่ต้องรู้ยี่ห้อหรือชนิดมอเตอร์. มีหมวดขวางแนว 2 หมวดที่ตัดสินด้วยภาระดูแล
ไม่ใช่ลักษณะงาน:

- **เครื่องจักรก่อสร้าง** — เครื่องจักรหนัก/อยู่กับที่ (ตบดิน, ดัดเหล็กเส้น):
  รอบบำรุงรักษาและมูลค่าต่างจากเครื่องมือถือ.
- **อุปกรณ์เซฟตี้** — PPE ตรวจสภาพตามรอบเวลา ไม่ใช่ตามงาน.

`รถขุด` / `รถหกล้อ` เป็นหมวดของ rental catalog (spec 361) — ไม่แตะ.

The 13 live categories after the seed (4 new ⁺, 2 renamed ᵣ):
เครื่องมือตัดและเจียร⁺ 15 · เครื่องวัด 11 · เครื่องมือเจาะและสกัดᵣ 8 ·
เครื่องมือช่างทั่วไป 7 · เครื่องมืองานปูน⁺ 6 · เครื่องมือเชื่อมและยึด⁺ 5 ·
เครื่องมือลม⁺ 3 · เครื่องจักรก่อสร้าง 3 · เครื่องสูบน้ำและอุปกรณ์ระบายน้ำ 2 ·
อุปกรณ์เซฟตี้ᵣ 2 · เครื่องเทส 1 (+ รถขุด/รถหกล้อ, 0 items, rental-only).
Renames: `เครื่องมือเจาะ` → `เครื่องมือเจาะและสกัด` (สกัดคอนกรีตอยู่หมวดนี้),
`Safety` → `อุปกรณ์เซฟตี้` (ชื่อไทยตามหลักการ; id เดิมทั้งคู่).

### Seed record

- **63 rows = 68 physical units** (rehearsal-rollback first, then commit;
  in-txn verify: 63 rows / 68 units / 13 cats / 0 unpriced / 0 mirror-mismatch).
- **unit vs bulk follows the sheet's own numbering**: anything the crew already
  labels `No.1, No.2, …` (even ฿10 คีมผูกลวด) = `unit` rows, one per physical
  tool, named exactly as labelled; un-numbered flat multiples
  (สามเหลี่ยมปาดปูน ×2+2, สายยางวัดระดับน้ำ ×3, แม่เหล็กจับฉาก ×2) = `bulk` + qty.
- Owner = **PRI** (default owner, `suppliers` id-mirror intact); `created_by` =
  dev-preview; brand/model captured where the sheet states them
  (XYLON Rebar Bender, ASADA TEST PUMP TP50E).
- **`daily_rate` seeded ฿10–300** on the same estimate scale the operator approved
  2026-07-28 — an unpriced item is P0001-refused at `check_out_equipment`, so NULL
  rates would kill the scan-ยืม door on day 1. PRI valuation supersedes; each rate
  is adjustable via `set_equipment_daily_rate` (procurement_manager is in its
  allowlist).
- **Location NOT seeded** — the sheet totals `มี 2 สาขา` without saying which
  branch holds which unit; inventing `deployed` movements would fake the ledger.
  Both sites exist as active projects (`PRC-2026-007` TFM นายาว, `PRC-2026-008`
  TFM กกกระทอน); locations get recorded per item at the store / scan door during
  the completion pass.
- **มี 0 rows were not seeded** (ปลั๊กพ่วงไฟฟ้า ทำเอง) — the registry records what
  the firm owns, not what it wants.
- The sheet's `จำนวนที่ต้องการ/ไซต์` + `จำนวนที่ขาด` columns are **per-site demand
  planning — deliberately NOT modelled** (prove-value: one-time move planning
  lives in the sheet; if gap tracking recurs, it needs a type grain above the
  per-unit rows, not a bolt-on).

**Her completion pass, per item, all on `/equipment`:** 4 photo slots (spec 382
chips รูป n/4) · serial/เพลท · condition · adjust rate · record the branch via a
movement. Readiness query = spec 382's photo fill rate + §11's column fill rate.
