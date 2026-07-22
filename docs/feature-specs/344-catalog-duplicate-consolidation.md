# Spec 344 — catalog duplicate consolidation + creation lock

**Status:** in progress (2026-07-23)
**Origin:** operator screenshot of `/catalog` → หมวด เหล็กโครงสร้าง showing six
`เหล็กเส้นกลมRB` rows: three with the size in the spec line, three with the size
baked into the name. Operator instruction, verbatim: _"these 6 are the doubled
items written by 2 people. consolidate them, then prevent it from ever happening
again (allow only procurement manager to add, not the staffs)"_, then _"Use the
top 3 items, remove the 3 below"_.

## 1. What is actually wrong (live evidence, 2026-07-23)

The operator saw one family. A normalized scan of the whole catalog —
`regexp_replace(lower(base_item || coalesce(spec_attrs,'')), '[[:space:]"'']', '', 'g')`
— finds **27 duplicate groups covering 54 rows**.

**25 of the 27** groups have the same shape (the other two are §1.2):

| side                        | `base_item`                    | `spec_attrs`    | created                                |
| --------------------------- | ------------------------------ | --------------- | -------------------------------------- |
| **STRUCTURED** (the keeper) | `เหล็กเส้นกลมRB`               | `6 มิล 10 เมตร` | 2026-06-23 / 06-24, by hand in the app |
| **FLAT** (the loser)        | `เหล็กเส้นกลมRB 6 มิล 10 เมตร` | `null`          | 2026-06-26 16:33:48, one transaction   |

The flat side is not a person. All 25 flat rows were created in a **single
transaction** at `2026-06-26 16:33:48.250665+00`, and every `stock_receipts` row
they carry is noted `ย้ายเข้าคลังจากงาน (backfill spec 208 U5)` — the store-first
backfill (ADR 0065) minted a fresh catalog item per free-text
`purchase_requests.item_description` instead of matching the structured row that
already existed.

**Why the existing guard missed it.** `catalog_items_identity_uniq` is
`unique (base_item, coalesce(spec_attrs, ''))` — an exact-string index. The two
shapes concatenate to the same product but hash to different keys, so the second
insert was accepted without a warning. A role gate would not have caught this
either: the writer was a migration, not a user.

### 1.2 Two groups are duplicated by WHITESPACE, not by shape

The other two groups have **both members structured**; they differ only inside
`base_item`:

| group                            | keeper                                                   | loser                                                 |
| -------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| ข้อต่องอ 45 องศา PVC ฟ้า         | `f99f69d8` single spaces — 25 on hand, 1 PR, 1 plan line | `bed58ee4` `ข้อต่องอ␣␣45␣␣องศา` — **zero references** |
| สกรูแปเหล็กสั้น สีขาว (เมทัลชีท) | `552ad815` 2,500 on hand, 2 PRs, created 06-27           | `d71eab0a` 1,200 on hand, 1 PR, created 07-18         |

So `keeper = spec_attrs is not null` is not a total rule. **The keeper rule is:
the row with more inbound references; on a tie, the older `created_at`.** That
picks the structured row in all 25 shape-pairs and resolves both of these. It
also matters mechanically: U3's index is partial on `is_active`, so leaving these
two groups un-merged would make `CREATE UNIQUE INDEX` fail — both members are
active and normalize identically.

### 1.1 The money question, and the operator's ruling

18 of the 27 groups hold stock on **both** sides, and in 16 of those the two
sides carry **identical quantity and satang-identical value** — e.g.
เหล็กกล่องดำ 2”x2”x2.3 มิล at 157 / ฿71,435 on each side. The lesser side totals
**฿238,021** across those 16 (฿245,901 across all 18). The two sides trace to
two different purchase orders three days apart: PO `47165c06` (raised 06-24,
delivered 06-26, backfilled to store) and PO `105853ad` (raised 06-27, delivered
07-04, received in the app by N-Nathamon), line-for-line identical.

That is either a genuine repeat order or one delivery keyed twice, and the
database cannot tell which. **Operator ruled 2026-07-23: two real deliveries.**

⇒ **The merge SUMS quantities. No `stock_receipts` is reversed, no GL entry is
contra'd, no `purchase_requests` row is cancelled.** The consolidation is
quantity-neutral by construction; the only thing that changes is which catalog
row the history hangs off.

9 groups are one-sided (only one member holds stock) and 2 hold different
quantities on each side; all three cases fall out of the same sum.

## 2. Non-goals

- No stock correction, no GL movement, no PR/PO cancellation (§1.1).
- No hard delete of the losing row — the app's established retire is
  `is_active = false` (`edit-catalog-item.tsx`, `set_catalog_item_active`), and
  `/catalog` already filters `is_active = true`, so a deactivated row leaves the
  screen. Deletion would also strip an id that `audit_log` jsonb payloads name.
- No renaming of surviving rows. The operator has already renamed live rows once
  (`เหล็กข้ออ้อยDB…`); names stay theirs.

## 3. Units

### U1 — `merge_catalog_items` RPC (schema, migration `075836`)

**The design constraint that shapes this unit.** A merge cannot repoint the stock
ledger. Verified live 2026-07-23:

- `stock_receipts`, `stock_returns`, `stock_reversals`, `stock_counts` each carry
  a `BEFORE DELETE OR UPDATE` trigger raising `P0001` —
  _"stock_receipts is append-only (correct via reversal, never mutate)"_. No
  escape hatch, no privileged bypass.
- `stock_issues_freeze_ledger` names `catalog_item_id` in its frozen-column list
  explicitly (only the custody columns may change).
- `purchase_requests` fires `enqueue_gl_posting_upd`, `notify_status_change` and
  `stock_in_on_receive` on UPDATE — repointing a PR is a GL/notification event,
  not a rename.

So the ledger stays where it is, which is also the accounting-correct answer:
those movements really did happen under that catalog id. **A merge is therefore a
fold-and-retire, not a history rewrite.**

`merge_catalog_items(p_keep uuid, p_drop uuid) returns void`, SECURITY DEFINER,
`search_path = public`. Gate: `super_admin` only — a data-repair tool, not a
daily affordance. No UI in this spec; U2 calls it from the Management API under
an impersonated super_admin session (the [[void-delivered-pr-chain]] recipe).

New column, same migration: **`catalog_items.merged_into uuid references
catalog_items(id)`** — nullable, set on the loser. It is what lets a reader union
the loser's immutable history under the keeper, and what lets the UI say where a
retired row went.

Refusals (all before any write):

| condition                                                                                                     | errcode |
| ------------------------------------------------------------------------------------------------------------- | ------- |
| caller is not `super_admin`                                                                                   | 42501   |
| `p_keep = p_drop`, or either id does not exist                                                                | 22023   |
| `p_drop` is already inactive, or already has `merged_into`                                                    | 22023   |
| `p_drop` is named by any `purchase_requests` row whose status is **not** terminal (`delivered` / `cancelled`) | 22023   |

The last one is the honest floor: an in-flight order against the losing row would
receive stock into a retired item. All 25 PRs on today's 27 losers are
`delivered`, so the merge is legal for every pair in U2.

Then, in one transaction:

1. **Fold** `stock_on_hand` — PK `(project_id, catalog_item_id)`, so a repoint
   would 23505 wherever both sides stock the same project. Sum `qty_on_hand` and
   `total_value` into the keeper per project, insert where the keeper has no row,
   delete the loser's rows. The table has **no triggers**, and the `inventory_1500`
   integrity check ties GL 1500 to the _global_ `sum(total_value)`, which this
   leaves byte-identical — so the tie stays green.
2. **Repoint** `supply_plan_lines` (forward-looking plan, not history) where the
   identity is free; delete the loser's line where the keeper already holds
   `(supply_plan_id, catalog_item_id, coalesce(work_package_id, …))`.
3. **Repoint** `boq_line` (no triggers) and `catalog_assembly_components` (both
   `assembly_id` and `component_item_id`).
4. **Fold** `item_sell_rates` — PK is `catalog_item_id`; the keeper's rate wins,
   the loser's row is deleted; move it only when the keeper has none.
5. **Delete** the loser's `catalog_item_categories` rows (the keeper owns its own
   `is_primary` membership; `catalog_item_categories_one_primary` would reject a
   repoint).
6. `update catalog_items set is_active = false, merged_into = p_keep where id = p_drop`.
7. One `audit_log` row — `action = 'update'`, `target_table = 'catalog_items'`,
   `target_id = p_drop`, payload `{"op":"merge_catalog_items", keep, drop, both
display names, per-project qty/value deltas}`. **`audit_action` is a Postgres
   enum with no merge-shaped value**; widening a governed enum for a tool that
   runs 27 times is not worth the exhaustiveness-guard churn, so the discriminator
   lives in the payload.

**Left untouched by design:** `stock_receipts`, `stock_issues`, `stock_returns`,
`stock_reversals`, `stock_counts`, `purchase_requests` — the immutable record.

### U1b — read the merged history under the keeper

Because the ledger stays behind, the keeper's store item-detail page would show a
balance that includes the loser's stock but a movement history that does not
explain it. The readers keyed on `catalog_item_id` resolve the id to
`{ id } ∪ { x : x.merged_into = id }` before querying, and the page shows a
`รวมมาจาก <ชื่อเดิม>` line so the older rows are attributable. Scope is fixed by
the reader survey; a reader that shows a balance without its movements is the
defect this unit exists to prevent.

### U2 — the prod data operation (27 pairs)

Keeper = the row with more inbound references, older `created_at` breaking a tie
(§1.2). On all 25 shape-pairs that is the STRUCTURED row, which is the operator's
"use the top 3, remove the 3 below" generalised — the structured shape is what
the app's own add form produces.

Run under an impersonated super_admin session, one transaction, with a dry-run
(`rollback`) proving the post-state before the committed run. Verify after:
27 rows inactive, zero references left on any loser, `sum(qty_on_hand)` and
`sum(total_value)` across the whole catalog unchanged to the satang.

### U3 — creation lock + the guard that actually prevents recurrence

**Role narrowing (the operator's explicit ask).** `create_catalog_item`'s gate
goes from `project_manager, super_admin, procurement, procurement_manager,
project_director` to **`procurement_manager, super_admin`**. New role-set
constant `CATALOG_CURATOR_ROLES` in `src/lib/auth/role-home.ts` — no existing set
is mutated (`BACK_OFFICE_ROLES` gates suppliers, equipment, contacts and the
`/catalog` page itself; narrowing it would strip unrelated screens). The server
action `createCatalogItem` and the `AddCatalogItem` button gate on the new set;
the `/catalog` page gate stays `BACK_OFFICE_ROLES` so procurement staff keep
read access to the master list they order from.

`update_catalog_item` keeps its current gate — editing a typo is not the hazard,
minting a second identity is.

**Normalized identity index (the guard that would have caught the 27).**

```sql
create unique index catalog_items_normalized_identity_uniq
  on public.catalog_items (
    regexp_replace(lower(base_item || coalesce(spec_attrs, '')), '[[:space:]"'']', '', 'g')
  )
  where is_active;
```

Partial on `is_active` so retired rows never block a legitimate re-creation, and
so U2's deactivated losers do not collide with their keepers. **This index cannot
be created before U2 lands** — sequence is U1 → U2 → U3.

## 4. Negative cases, Thai strings, recovery

| #   | Mode                                                           | Layer                               | Thai string                                     | Recovery                                    |
| --- | -------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| N1  | Non-super calls `merge_catalog_items`                          | RPC 42501                           | `ไม่มีสิทธิ์รวมรายการวัสดุ`                     | none — tool is super-admin-only by design   |
| N2  | `p_keep = p_drop`, or either id unknown                        | RPC 22023                           | `เลือกรายการที่จะรวมไม่ถูกต้อง`                 | pick two different existing items           |
| N3  | `p_drop` already inactive or already merged                    | RPC 22023                           | `รายการนี้ถูกเอาออกไปแล้ว`                      | already merged; nothing to do               |
| N3b | `p_drop` still named by a non-terminal `purchase_requests` row | RPC 22023                           | `รายการนี้ยังมีคำขอซื้อที่ยังไม่ปิด`            | close or cancel the order first, then merge |
| N4  | Non-curator submits the add form                               | action, from RPC 42501              | `ไม่มีสิทธิ์เพิ่มรายการวัสดุ` (exists)          | ask a หัวหน้าฝ่ายจัดซื้อ to add it          |
| N5  | Add form: name+spec normalizes onto a live item                | action, from 23505 on the new index | `รายการนี้มีอยู่แล้ว (ชื่อ + สเปกซ้ำ)` (exists) | search the catalog and use the existing row |
| N6  | Non-curator loads `/catalog`                                   | page                                | button absent, list still readable              | read-only by design                         |

N4 and N5 reuse the strings already in `src/app/catalog/actions.ts`; N1–N3 are
new and single-surface (the RPC has no UI in this spec), so they stay in the
migration rather than `labels.ts`.

## 5. Verification

- pgTAP `344-catalog-merge`: N1/N2/N3/N3b `throws_ok` message-pinned; a fold case
  where both sides stock the same project (summed into one surviving row); a case
  where only the loser stocks a project (keeper gains the row); `supply_plan_lines`
  collision dropped and free line repointed; `item_sell_rates` keeper-wins; loser
  left `is_active = false` with `merged_into` set; **the ledger rows still point at
  the loser** (the append-only invariant, asserted positively so a future
  "improvement" that repoints them reds); global `sum(stock_on_hand.total_value)`
  unchanged across the merge (the `inventory_1500` tie); the audit row.
- pgTAP `344-catalog-creation-lock`: `procurement` and `project_manager` refused
  by `create_catalog_item`, `procurement_manager` accepted; the normalized index
  refuses the flat/structured pair in both insertion orders.
- vitest: `CATALOG_CURATOR_ROLES` membership pinned by literal (not
  self-referentially); `AddCatalogItem` absent for `procurement`, present for
  `procurement_manager` — mutation-checked by deleting the gate.
- Prod: the sum-unchanged assertion in U2, and `/catalog` → เหล็กโครงสร้าง
  showing three `เหล็กเส้นกลมRB` rows, not six.

## 6. Open questions / out of scope (surfaced, deliberately not built)

1. **`store_pnl` groups by catalog item**, so a merged pair keeps two P&L lines —
   the retired name still carries the issues booked against it. Honest history,
   but the store P&L screen will show a split. Fold it with `merged_into` if the
   operator finds it confusing.
2. **`src/lib/purchasing/validate-purchase-request.ts` only shape-checks the
   catalog id** — it never verifies `is_active`, so the PR write path would accept
   a retired item id posted directly. Every _picker_ filters `is_active`, so this
   is not reachable through the UI. Pre-existing, not created by this spec.
3. **Two `stock_on_hand`-driven surfaces do not filter `is_active`** — the เบิก
   picker and the store on-hand list. A merged loser has no `stock_on_hand` row
   left, so it disappears from both by construction; a _hand-retired_ item with
   stock would not. Pre-existing.
4. **The merge audit row is not readable by `procurement_manager`.** The
   `audit_log` SELECT policy that keys on `payload->>'event'` is an allowlist of
   two WP events; everything else is super_admin / project_director /
   project_manager / accounting. Correct for a super-admin repair tool — noted so
   a future reader is not surprised.
