# On-site storage unit — seed dataset

Working scratch for the storage-unit / inventory feature (pre-spec). Source of truth for
the decisions taken with the operator on 2026-06-22.

## Source

`seed-units.csv` and `seed-catalog.csv` are derived from one real per-site purchase log
(Google Sheet, previous site). That sheet is the _current_ "system": date · supplier ·
item desc · qty · unit · unit price · amount · tracking status, logged ad-hoc.

## What the store is (decided)

A storage unit is a **transfer-pricing business unit**, not just a shelf:

- **Stock-in (รับเข้า)** — store buys from supplier at **cost**.
- **เบิก / Issue** — WP draws stock; store **sells** to the WP at a **per-item sell rate**.
  WP material cost = store sell price at issue (NOT purchase price).
- **Store P&L** = Σ(sell − cost) − shrinkage − holding. Mirrors the labour model (spec 161).
- Valuation = **moving weighted-average cost**.
- **Cost-first staging**: ship inventory mechanics at cost; bolt on the margin/sell-rate
  layer last (it rewires `wp_profit` and rides the still-uncalibrated spec-161 engine).

## Three flows + names

1. **Supply Plan (แผนจัดหา)** — PM, frozen baseline, per-project, **qty-per-WP**,
   PD approves once (item/spec/qty/ETA/buy-price/compared quotations).
2. **Stock-In (รับเข้า)** — procurement → PO → received into store. Reuse deliveries (spec 135).
3. **เบิก / Issue** — WP draws from store; inventory-out + internal sale; custody handshake.
4. **Reactive PR** (existing) — only for items not in store; tag reason
   (`unplanned-miss` dings PM; rework/breakage/scope-change/unforeseeable do not).

## Catalog decisions baked into the seed

- **Item identity ≠ description.** The sheet bakes spec AND usage-location into names
  ("ลอนตรง CC/760 สีขาว ยาว 3.83 ม. ด้านหน้าบนหลังคา…"). Catalog splits into
  `base_item` + `spec_attrs`. **Location lives on the WP allocation, never in the item name.**
- **`stockable` flag.** Only physical, re-stockable goods sit in the store. Made-to-length
  roofing (CC/760, ครอบ), made-to-order doors/stainless fab, and engineered tanks are
  `stockable=N` → bought direct-to-WP, never inventoried.
- **Non-stock lines excluded entirely.** Freight (เที่ยว), service/labour lumps (งาน),
  VAT 7%, WHT 3%, deposit (มัดจำ), discount (ส่วนลด) appear on purchase docs and hit GL,
  but are NOT catalog items and never enter stock. Units `เที่ยว` / `งาน` are tagged
  `non-stock` in `seed-units.csv` as a guard.
- **Unit normalization.** English `SET`→`ชุด`, `Piece`→`ชิ้น`, `ก.ล`→`แกลลอน`.
  Packaging units (มัด/กล่อง/ถุง) flagged — base-unit conversion (box→piece) is deferred.

## Known data issues carried forward

- Screws are listed with unit `แผ่น` in the source sheet — wrong; corrected to `ตัว`
  in the catalog. Confirm with operator before seeding.
- Many prices blank in source (quotation-only / no bill). Sample prices are indicative,
  not authoritative — real cost comes from actual receipts at stock-in.
- `แผ่นอลูซิงค์` sold by `ม.` (cut) — borderline stockable; left `Y`, flag at review.

## Open questions for operator

- Confirm the screw-unit correction and the `stockable=N` calls on roofing / fab / tanks.
- Category list (12 used here) — keep, or map to an existing taxonomy?
- Sell-rate maintenance: who sets per-item sell rate (mirror `set_sell_rate`: super/director)?

## Phasing (agreed)

1. Catalog (this seed) → 2. Supply Plan + reactive reason codes → 3. Store + stock-in (at cost)
   → 4. เบิก/issue ledger + custody handshake → 5. stock-on-hand + count/variance
   → 6. performance dashboard → 7. BU margin layer (sell rate, moving-avg, flip wp_profit)
   → 8. external sales (later).
