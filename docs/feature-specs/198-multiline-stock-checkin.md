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

### U2 — Divert a delivered WP-bound line into the store (with GL transfer)

**Decision (operator AskUserQuestion 2026-06-24): Option 3 — divert WP-bound →
store with a proper GL move.** Investigation showed "pre-fill รับเข้า from a
delivery" has no cost-clean target by the _simple_ interpretation: store-bound
(WP-less + catalog) lines **already auto-check into stock on receive** (spec 195
P3 — `purchase_requests_stock_in_on_receive`, books Dr 1500 / Cr AP, suppresses
the WP-WIP posting), and a `stock_receipts.purchase_request_id` unique index
already blocks re-stocking them. The only lines _not_ auto-booked are **WP-bound**
— whose cost has already posted to the WP's WIP (`post_purchase_to_gl` →
Dr 1400 WP-WIP / Cr 2100 AP). Stocking such a line as-is would book Dr 1500 again
= **double-count**. So U2 is a real **inventory-diversion with a cost transfer**,
not a UI convenience.

**What it does:** on a delivered, WP-bound, catalogued PR line, the storekeeper
can "ย้ายเข้าคลัง" (move into store). The material leaves the WP and becomes store
stock; its cost moves WP-WIP → Inventory. A later เบิก returns it Dr WP-WIP /
Cr Inventory (spec 177/178), so the WP's material cost lands once, at usage —
exactly the store-bound model.

**GL transfer (net):** reverse the WP purchase (Dr 2100 AP / Cr 1400 WP-WIP) +
the new stock_receipt books (Dr 1500 Inventory / Cr 2100 AP). Net: WP-WIP → 0,
Inventory + cost, **AP unchanged** (one liability, as it should be).

**Mechanism (all through the existing async outbox + `drain_gl_posting`):**

- New definer RPC `divert_purchase_to_store(p_request_id)` — gate `SITE_STAFF`
  (site_admin + PM tier; physical store action, procurement read-only in the
  store per spec 197); membership `can_see_project`; guards: PR `delivered`,
  `work_package_id IS NOT NULL`, `catalog_item_id IS NOT NULL`, not already
  diverted (the `stock_receipts_pr_uniq` index is the hard guard). It:
  1. **reverses the WP-bound purchase's posted GL entry directly** —
     `reverse_journal_internal` on the posted, non-reversed `purchase` entry
     (Dr 2100 AP / Cr 1400 WP-WIP); the cost leaves the WP synchronously;
  2. **skips any still-pending/posting `purchase` outbox job** (→ `skipped`) so it
     can't post WP-WIP after the divert (if it never drained, no WP-WIP ever; the
     receipt is the sole AP booking — the P3 store-bound model);
  3. inserts a `stock_receipts` row (all-in cost = amount/qty, `purchase_request_id`
     stamped) + rolls `stock_on_hand` — the insert auto-enqueues its `stock_receipt`
     GL job (Dr 1500 / Cr AP on drain), mirroring P3;
  4. sets the PR's `work_package_id = NULL` (now store-bound — wp_profit's
     GL-materials term excludes it, the store-sell term is disjoint, per spec 178 U4).
- **`post_purchase_to_gl` is unchanged.** An earlier re-enqueue design failed
  because that poster only accepts `purchased`/`site_purchased` (a _delivered_ PR
  raises `P0001`) — pgTAP 216 caught it — so the divert reverses directly instead.
- **Async-timing safety:** purchase already posted → step 1 reverses it; still
  pending → step 2 skips it (no WP-WIP ever). Both converge to the same net.

**UI:** the คลัง surfaces a "ย้ายเข้าคลัง (จากการส่งของ)" list — the project's
delivered, WP-bound, catalogued PR lines not yet diverted (item + qty + WP +
cost). Each has a confirm `ย้ายเข้าคลัง` action → `divert_purchase_to_store`.
(Per-line, fixed item/qty/cost from the PR — no grid editing needed; reuses
nothing from U1's ad-hoc grid beyond the store surface.)

**Resolved at build (operator approved "build + push with ADR"):**

- `post_purchase_to_gl` stays untouched (the divert reverses directly).
- Reclassifying the PR `work_package_id → NULL` (it loses its WP identity in the
  PR list; trace is kept via `stock_receipts.purchase_request_id`).
- Diverting a _partially_-consumed WP line is **not** allowed (v1: whole line only).
- Likely warrants an ADR (inventory diversion + cost transfer is an architecture
  decision).

### U3 — Check into inventory from the delivery page

**Why (operator):** "checking into inventory from delivery related page." U2 put
the ย้ายเข้าคลัง (divert) action on the คลัง page; the natural place to do it is
also the **delivery detail page** — where you actually receive the goods and see
the งวด's lines. Surface the same divert there.

- The delivery detail page (`/requests/orders/[poId]/deliveries/[deliveryId]`)
  already lists "รายการในงวดนี้". Add a `DivertToStoreList` section (the U2
  component, unchanged) fed by **this delivery's** delivered, WP-bound, catalogued
  lines not yet diverted. Gated to `SITE_STAFF` (the divert RPC gate; procurement
  reaches the page via `PURCHASING_ROLES` but stays read-only in the store).
- Engine is unchanged — reuses `divert_purchase_to_store` + `divertPurchaseToStore`.
  No DB. The line read mirrors the คลัง page's, scoped by `purchase_order_id` +
  `delivery_id` instead of `project_id`.
- Extract the row→`DivertLine` mapping into a shared, tested helper
  (`toDivertLines`) used by both the คลัง page and the delivery page (DRY).

## Out of scope / open

- No change to the cost model, moving-average, GL posting, or custody — only the
  _entry_ batches. Each line is still one `stock_receipts` row at cost.
- `record_stock_in` (single) is **kept**, not replaced — spec 195 P3 and existing
  callers/tests depend on it.
- A per-row supplier/note in the grid is optional (most check-ins share one
  supplier); a future "apply supplier to all rows" convenience is out of scope.
- The U2 anti-double-book rule vs spec 195 P3 auto-receipt is the main open design
  question — settle it at U2, not U1.
