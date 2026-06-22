# Spec 177 — Store + Stock-In (รับเข้า) at cost

**Status:** U1 + U2 SHIPPED to prod (2026-06-22). Phase 3 of the on-site storage / inventory arc.
U1 = data foundation (`stock_receipts` + `stock_on_hand` + `record_stock_in`, mig 20260809000000, pgTAP 181).
U2 = the `/store` surface (project picker → on-hand + รับเข้า form; `StoreManager` + `recordStockIn`; mig 20260809000100 adds `default null` to the two nullable RPC args).
U3 = เบิก/Issue DB foundation (`stock_issues` + `issue_stock` RPC: SITE_STAFF gate, decrement on-hand at moving-avg cost, insufficient-stock guard, depletion→value 0; mig 20260809000200, pgTAP 182).
U4 = the เบิก UI on /store (per-row เบิก button → WP+qty sheet → `issueStock`; recent-issues list; manager-tier gated; `STORE_ISSUE_LABEL`). Code-only, no DB change.
U5 = เบิก at the WP detail (site_admin field-draw) — `WpIssueStock` block in the คำขอซื้อ tab (gated `!readOnly` = SITE_STAFF), draws the project's on-hand TO this WP; reuses `issueStock`. Code-only. **เบิก now has both surfaces (/store managers + WP detail field).**
U6 = two-party custody handshake (operator: issue-now-then-receiver-confirms; receiver = a worker) — `stock_issues` += receiver_worker_id + received_at; `issue_stock` widened (+p_receiver_worker_id); `confirm_stock_issue` = the named receiver worker attests via the portal (current_user_worker_id); mig 20260809000300, pgTAP 183. NEXT = U7 the custody UI (receiver picker + portal confirm).
**Predecessors:** spec 175 (item catalog), spec 176 (supply plan). See memory `storage-unit-inventory-bu`.

## Why

The on-site **store** is a transfer-pricing business unit (not a shelf). Phase 1 built the
item catalog; Phase 2 built the PM supply plan + accuracy measure. Phase 3 puts **stock on
hand**: goods enter the store, at **cost**, and the store knows what it holds and what that
holding is worth. This is the inventory mechanic the later เบิก/Issue (Phase 4) draws from
and the later margin layer (Phase 7) re-prices against.

**Cost-first staging is a locked dial** (memory): ship the inventory mechanics AT COST now.
The sell-to-WP margin layer, the flip of `wp_profit` to at-issue-sell-price, and external
sales are LATER phases — explicitly NOT this spec.

## Operator decisions (AskUserQuestion, 2026-06-22)

1. **Stock-in source = standalone catalog-keyed receipt.** A "store buys catalog item X,
   qty Y, at unit-cost Z from supplier S" entry that keys cleanly on `catalog_item_id`. It
   does **not** touch the existing PR/PO/delivery flow (whose lines are free-text, no catalog
   link) — zero purchasing-break risk. A future PO→store linkage is a flagged follow-up.
2. **On-hand model = per-project, no `stores` table.** On-hand is keyed by
   `(project_id, catalog_item_id)` — the project's on-site store is implicit. Matches the
   operator's "1 unit per site", RLS rides the existing `can_see_project`, and issue-to-WP
   (Phase 4) stays in-project.
3. **Costing now.** Each stock-in updates `qty_on_hand` + `total_value`; moving-average unit
   cost = `total_value / qty_on_hand`. This is the COST basis (cost-first), not the
   sell/margin layer. Tracking it now avoids a costing backfill later.

## U1 — data foundation (this unit, DB-only)

Mirrors the spec-176-U1 cadence: tables + the write RPC + the derived on-hand state, verified
by pgTAP. The `/store` read+record UI is **U2**.

### Tables

**`stock_receipts`** — append-only stock-in (รับเข้า) events. One row = one receipt of one
catalog item into one project's store, at cost.

| column            | type          | notes                                                                           |
| ----------------- | ------------- | ------------------------------------------------------------------------------- |
| `id`              | uuid pk       |                                                                                 |
| `project_id`      | uuid not null | FK `projects` — which site's store                                              |
| `catalog_item_id` | uuid not null | FK `catalog_items` — the item identity                                          |
| `qty`             | numeric(12,2) | check `> 0`                                                                     |
| `unit`            | text not null | **snapshot** of the catalog item's unit at receipt (the count's unit of record) |
| `unit_cost`       | numeric(12,2) | baht per unit, check `>= 0` (free issues / internal transfer allowed at 0)      |
| `total_cost`      | numeric(16,2) | **generated** `qty * unit_cost` stored — no RPC arithmetic drift                |
| `supplier_id`     | uuid          | nullable FK `suppliers` — who it was bought from (optional in U1)               |
| `received_at`     | timestamptz   | default `now()`                                                                 |
| `note`            | text          |                                                                                 |
| `created_by`      | uuid          | FK `users`, default `auth.uid()`                                                |
| `created_at`      | timestamptz   | default `now()`                                                                 |

Append-only (CLAUDE.md doctrine): no UPDATE/DELETE policy. Corrections = a later
reversal/negative-receipt unit (flagged), never an in-place edit.

**`stock_on_hand`** — derived current state, **one row per `(project_id, catalog_item_id)`**.

| column            | type                            | notes                                     |
| ----------------- | ------------------------------- | ----------------------------------------- |
| `project_id`      | uuid not null                   | FK `projects`                             |
| `catalog_item_id` | uuid not null                   | FK `catalog_items`                        |
| `qty_on_hand`     | numeric(16,2)                   | default 0                                 |
| `total_value`     | numeric(18,2)                   | default 0 — baht value of holding at cost |
| `updated_at`      | timestamptz                     | default `now()`                           |
| pk                | `(project_id, catalog_item_id)` |                                           |

Moving-average unit cost is **derived**, not stored: `total_value / qty_on_hand`. For a pure
stock-IN the maintenance is purely additive (`qty += qty`, `total_value += total_cost`) — the
weighted-average recompute only matters on issue-OUT (Phase 4). RLS read-only to authenticated;
no write policy (the RPC is the sole writer).

### RPC

```
record_stock_in(
  p_project_id      uuid,
  p_catalog_item_id uuid,
  p_qty             numeric,
  p_unit_cost       numeric,
  p_supplier_id     uuid,   -- nullable
  p_note            text    -- nullable
) returns uuid              -- the new stock_receipts.id
```

SECURITY DEFINER, `set search_path = public`.

- **Role gate:** `current_user_role()` in `BACK_OFFICE_ROLES`
  (`project_manager`/`super_admin`/`procurement`/`project_director`) — the cost-bearing
  curation tier; the documented รับเข้า actor is procurement. (SA self-receive = flagged
  follow-up, self-governance.)
- **Membership:** `can_see_project(p_project_id)` **OR** `current_user_role() = 'procurement'`
  — procurement is a cross-project curator (mirrors spec 171/172); PM by membership;
  super/director see-all via `can_see_project`.
- **Validations** (all `22023` unless noted): project exists; catalog item exists **and is
  active** (snapshot its `unit`); `p_qty > 0`; `p_unit_cost >= 0`; supplier (if given) exists.
  Non-member non-procurement → `42501`.
- **Effect:** insert one `stock_receipts` row; upsert `stock_on_hand` (`on conflict
(project_id, catalog_item_id) do update set qty_on_hand = +p_qty, total_value = +total_cost,
updated_at = now()`). Return the receipt id.

### RLS read posture

`stock_receipts` + `stock_on_hand` SELECT: `can_see_project(project_id)` **OR**
`current_user_role() = 'procurement'` (procurement must read what it writes; mirrors the
spec-171 procurement-arm-beside-`can_see_project` pattern). No INSERT/UPDATE/DELETE policy on
either — `record_stock_in` (definer) is the only write path.

### Out of scope (flagged, not built)

- **/store UI** (read on-hand + the record-stock-in form) → **U2**.
- **เบิก/Issue (issue-out, two-party custody, weighted-avg-cost decrement)** → Phase 4.
- **GL posting of stock-in** (Dr Inventory / Cr AP) — deferred; cost-first inventory
  mechanics only. A later unit wires `record_stock_in` into the spec-149 GL outbox.
- **PO→store linkage** (a received PO line lands in on-hand) — needs `catalog_item_id` on
  PR/PO lines first; standalone receipt is the U1 path.
- **Reversal / correction** of a receipt (append-only negative entry) — later unit.
- **Required supplier**, **stock count / variance**, **moving-avg flip of `wp_profit`** — later.

### Verification

pgTAP file 181: structure (both tables + RLS + RPC + anon-deny), happy path (procurement
cross-project + PM member), moving-average maths across two receipts at different unit costs,
generated `total_cost`, and every deny/validation branch. Plus `pnpm lint && typecheck &&
test`, `db:push`, `db:types`, `db:test`, `pnpm build`.

Migration `20260809000000`. Next pgTAP file `181`.
