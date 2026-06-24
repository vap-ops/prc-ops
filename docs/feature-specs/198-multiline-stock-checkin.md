# Spec 198 — Multi-line รับเข้า (bulk stock check-in)

**Why:** operator — "Checking in items is too difficult, having to select one
item at a time. Naturally the check-in list should be the same as delivery."
The คลัง `รับเข้าสต๊อก` form (spec 177/197) records **one** catalog item per
submit: open sheet → pick item → qty → cost → save → reopen for the next item. A
real delivery is a _list_ of items; checking it in one-at-a-time is slow and
error-prone. The delivery flow (`PoReceiveSection` → `receivePoLines`) already
receives many lines in one pass — รับเข้า should match that.

**Decision (operator, AskUserQuestion 2026-06-24): Both** — a multi-line grid for
ad-hoc รับเข้า, AND pre-fill the grid from a PO delivery. Sequence the **grid
first** (U1), then **pre-fill-from-delivery** (U2).

This is **new capability** (the spec-197 store specs were placement-only; this
adds a bulk write path). It does not change the cost model: every line is still a
single `stock_receipts` row at cost, rolled into `stock_on_hand` moving-average —
only the _entry_ batches. The single-line `record_stock_in` stays (spec 195 P3
auto-receipt + any other caller depend on it); the bulk path is additive.

## Units

Each unit is its own TDD loop (failing test first) and its own ship. Do not start
the next unit in the same session.

### U1 — Multi-line รับเข้า grid (ad-hoc)

The `รับเข้าสต๊อก` sheet becomes a **multi-row grid**, mirroring the supply-plan
inline grid (spec 181 U2) and the delivery checklist. One submit records all rows
atomically.

- **DB:** new `record_stock_in_bulk(p_project_id uuid, p_lines jsonb)` definer RPC.
  - Role gate identical to the post-spec-197 `record_stock_in`:
    `site_admin · project_manager · super_admin · procurement · project_director`
    (42501 otherwise). Membership: `can_see_project(p_project_id) OR role =
'procurement'` (42501). Unknown project → 22023.
  - `p_lines` must be a non-empty json array (22023 if not an array or empty).
  - Per line `{catalog_item_id, qty, unit_cost, supplier_id?, note?}`: same
    validation as the single RPC — `qty > 0`, `unit_cost >= 0`, catalog item
    exists+active (snapshot its `unit`), supplier (if given) exists — each 22023.
  - **Atomic:** validate + insert every line in one loop; any bad line raises and
    the whole batch rolls back (no partial check-in). Each line inserts a
    `stock_receipts` row and rolls additively into `stock_on_hand` (the exact
    upsert `record_stock_in` uses). Returns the count inserted.
  - `revoke … from public, anon; grant execute … to authenticated` — and **do
    not** re-grant anon (CREATE, not CREATE OR REPLACE, so no Supabase default-priv
    surprise; still assert anon-deny in pgTAP).
- **App:** `recordStockInBulk({ projectId, lines })` server action (maps rows →
  jsonb `[{catalog_item_id, qty, unit_cost, supplier_id, note}]`, calls the RPC,
  `revalidatePath` the store route). The `รับเข้าสต๊อก` sheet in `StoreManager`
  swaps its 5 single-value fields for a **grid of draft rows** (item select +
  qty + unit_cost, with supplier + note optional per row), an `+ เพิ่มรายการ`
  add-row control, per-row remove, and one `บันทึกทั้งหมด` submit. Disabled until
  ≥1 complete row (item + qty>0 + cost≥0). Reuse the supply-plan grid idiom
  (`DraftRow[]` state) and the existing category-grouped item `<select>`.
- The single-item path is removed from the UI (the grid with one row covers it),
  but `record_stock_in` (the RPC) and `recordStockIn` (the action) stay for the
  spec-195 P3 auto-receipt and tests.

### U2 — Pre-fill รับเข้า from a PO delivery

Let the check-in grid be **seeded from a PO delivery's lines** so the storekeeper
confirms a real delivery into stock without re-picking each item.

- The คลัง `รับเข้า` offers a "รับเข้าจากการส่งของ" entry: pick a PO / delivery
  visible for this project → its store-bound lines (catalog item + qty + the PO's
  unit price as the cost default) pre-populate the grid → review/adjust → submit
  via the U1 bulk path.
- **Guard against double-booking:** spec 195 P3 already auto-creates a
  `stock_receipt` when a **WP-less** (store-bound) PO line is received. U2 must
  not re-book those. Scope U2's pre-fill to lines that did **not** auto-book
  (e.g. WP-bound PO lines the storekeeper chooses to stock instead, or deliveries
  predating P3), and/or mark pre-filled lines with the source delivery so a line
  can't be checked in twice. Exact rule = decide at U2 design (raise before build).
- Reuses the U1 RPC + grid; adds only the delivery picker + line read + the
  anti-double-book rule.

## Out of scope / open

- No change to the cost model, moving-average, GL posting, or custody — only the
  _entry_ batches. Each line is still one `stock_receipts` row at cost.
- `record_stock_in` (single) is **kept**, not replaced — spec 195 P3 and existing
  callers/tests depend on it.
- A per-row supplier/note in the grid is optional (most check-ins share one
  supplier); a future "apply supplier to all rows" convenience is out of scope.
- The U2 anti-double-book rule vs spec 195 P3 auto-receipt is the main open design
  question — settle it at U2, not U1.
