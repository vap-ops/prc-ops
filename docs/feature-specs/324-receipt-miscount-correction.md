# Spec 324 — Receipt Miscount Correction (over-accepted delivery)

**Status:** APPROVED — plan written (`324-receipt-miscount-correction-plan.md`); build started 2026-07-16 (operator "build 324")
**Author:** design session 2026-07-16
**Depends on / touches:** spec 177 (store stock-in / reversal / count), spec 178 (store GL posting + adjustments), spec 195 P3 (receive-into-store trigger), spec 208 U4b (receipt VAT split), spec 261 (parity gates), spec 283 (integrity console), the journal posting engine, and `gl_posting_outbox` drain.
**Doctrine:** [[store-first-material-flow-doctrine]], [[sa-custody-doctrine]], [[void-delivered-pr-chain]], [[gl-poster-redrain-guard-2026-07]], [[rls-self-check-coalesce]].

---

## 1. Problem

A site admin (SA) receives a delivery on `/projects/[projectId]/incoming/[deliveryId]`. The confirm is an **all-ticked checklist** (`receive_po_lines`) with **no quantity input** — ticking a line books the PR's **ordered** quantity into the store. Grounded facts:

- `receive_po_lines(p_request_ids uuid[], p_received_by, p_delivery_note)` takes **no count**; it only stamps `delivered_at` on in-transit lines.
  (`supabase/migrations/20260717000000_receive_site_only.sql`)
- The delivered flip fires `purchase_requests_stock_in_on_receive`, which inserts `stock_receipts.qty = new.quantity` (**ordered qty**) and rolls `stock_on_hand`.
  (`supabase/migrations/20260813003500_spec208u4b_receipt_vat_split.sql:79`)
- Async GL posts **Dr 1500 Inventory (net) / Dr 1300 Input VAT (if `vat_rate>0`) / Cr 2100 AP (gross)** on that ordered basis.

So when the SA **miscounts and accepts all** but fewer units physically arrived, both `stock_on_hand` **and** the supplier **AP (2100)** are overstated, and no clean correction exists:

| Existing path                       | Who                                        | Why it's wrong for a miscount                                                                                                        |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `reverse_stock_receipt`             | back-office/procurement (NOT `site_admin`) | all-or-nothing (can't shave 20 off 100); blocked once any stock issued out (`22023`)                                                 |
| `record_stock_count`                | `site_admin` can                           | books the gap as **inventory shrinkage** to store P&L and **leaves AP overstated** — wrong story (goods never existed, weren't lost) |
| `split_purchase_request_on_receipt` | site                                       | only works **before** confirm and only for _under_-ordered; useless after a blind full-confirm                                       |

## 2. Decisions (locked with operator)

1. **Authority = back-office only.** The money fix belongs to `procurement / procurement_manager / project_manager / super_admin / project_director`. The SA **escalates**.
2. **Both surfaces.** SA raises an in-app **flag**; back-office (BO) applies the correction. BO may also correct directly without a flag.
3. **Fresh-pool window only — block + guide otherwise.** A partial receipt-cost correction is only sound while this receipt's stock has not been drawn or re-blended. Once the `(project, item)` pool has been issued/returned/counted since the receipt, the correction **refuses with guidance** (it does not attempt a WIP unwind). See §5.
4. **Close short only.** The correction trues the receipt down to what actually arrived; there is **no remainder / "rest is coming"** path (that is the existing pre-receive `split`'s job — and `split` cannot be reused post-delivery anyway).

## 3. Non-goals (scope fences)

- **Over-received** (physically _more_ than ordered) — OUT. Unrepresentable today and a separate feature.
- **WP-bound PRs** — OUT. They never create a `stock_receipts` row (`purchase_requests_stock_in_on_receive` short-circuits on `work_package_id is not null`), so there is nothing to correct or flag. The SA flag surface must hide WP-bound lines, not 404.
- **Dirty-pool WIP repair** — OUT. When the phantom has already been issued into WIP 1400, a receipt-layer 1500/2100 contra cannot un-mis-cost WIP (moving-average, no lot tracking). The correction blocks in that state (§5); walking WIP back is deferred (Appendix B).
- **`site_purchase_use_now`** receipts — OUT (refused). Received-and-immediately-issued; on-hand nets to 0 and AP 2100 there is a cash proxy, not a payable.

## 4. Data model (2 new append-only tables)

### 4.1 `receipt_correction_requests` (the SA flag)

```
id                uuid pk
receipt_id        uuid not null references stock_receipts(id)
proposed_qty      numeric(12,2) not null check (proposed_qty >= 0)
reason            text not null
photo_path        text            -- required at the app layer; storage object key
status            text not null default 'pending'
                    check (status in ('pending','applied','rejected','obsolete'))
requested_by      uuid not null references users(id) default auth.uid()
requested_at      timestamptz not null default now()
decided_by        uuid references users(id)
decided_at        timestamptz
decision_note     text
correction_id     uuid references stock_receipt_corrections(id)  -- set when applied
```

- **One open flag per receipt:** `create unique index rcr_one_pending on receipt_correction_requests (receipt_id) where status = 'pending';` — a real partial unique index, **not** the change-request templates' exists-check (which is a TOCTOU race — verified: `submit_worker_bank_change` / `submit_identity_change` guard in app code over non-unique btrees).
- Append-only (block-mutation trigger); RPC-only writer.

### 4.2 `stock_receipt_corrections` (the applied correction)

```
id                uuid pk
receipt_id        uuid not null references stock_receipts(id)
request_id        uuid references receipt_correction_requests(id)  -- null for direct BO correct
removed_qty       numeric(12,2) not null check (removed_qty > 0)
removed_net       numeric(16,2) not null      -- removed_qty * receipt.unit_cost (net)
removed_vat       numeric(16,2) not null default 0
removed_gross     numeric(16,2) not null      -- removed_net + removed_vat (residual)
true_qty          numeric(12,2) not null check (true_qty >= 0)
reason            text not null
supplier_id       uuid references suppliers(id)   -- copied from the receipt (may be null)
corrected_by      uuid not null references users(id) default auth.uid()
corrected_at      timestamptz not null default now()
```

- **Cumulative guard (this table, NOT `stock_reversals`):** enforce `Σ removed_qty over receipt_id ≤ stock_receipts.qty` and `Σ removed_net ≤ stock_receipts.total_cost`, asserted under the `stock_on_hand` row lock. (The one-per-receipt uniqueness that protects `reverse_stock_receipt` lives on a _different_ table and does not apply here.)
- Append-only; AFTER-INSERT enqueue trigger → `gl_posting_outbox`.
- **The correction is the SSOT of "actually received".** We do **not** mutate `purchase_requests.quantity` (append-only posture; avoids re-firing delivery triggers on a delivered row). UI derives "รับจริง {true_qty} (สั่ง {ordered})" from the correction.

## 5. `correct_stock_receipt(p_receipt_id uuid, p_true_qty numeric, p_reason text, p_request_id uuid default null)`

`SECURITY DEFINER`. Ordered preconditions — **all validated before any `stock_on_hand` or GL write**:

1. **Role gate (null-safe):** `if v_role is null or v_role not in ('procurement','procurement_manager','project_manager','super_admin','project_director') then raise 42501`.
2. **Range:** `0 <= p_true_qty < receipt.qty` → else reject (`removed = receipt.qty - p_true_qty` must be `> 0` and `<= receipt.qty`). This makes the "over is out of scope" fence an explicit precondition, not emergent arithmetic.
3. **Origin:** reject `site_purchase_use_now` receipts (heuristic: a same-`(project,item)` `stock_issue` created in the receipt's own txn / the use-now note marker). Reject a receipt with no live inventory contribution.
4. **Not already unwound:** anti-join — `not exists (stock_reversals where receipt_id = p_receipt_id)`; and cumulative-corrected `Σ removed_qty < receipt.qty`. (Append-only tables carry no status flag, so guard by anti-join.)
5. **Fresh-pool gate** — take `select … from stock_on_hand where (project_id,catalog_item_id) for update`, then require **all**:
   - `not exists (stock_issues  s where s.project_id=P and s.catalog_item_id=I and s.created_at >= receipt.received_at)`
   - `not exists (stock_returns r where … r.created_at >= receipt.received_at)`
   - `not exists (stock_counts  c where … c.counted_at  >= receipt.received_at)`
   - `on_hand.qty_on_hand   >= removed_qty`
   - `on_hand.total_value - removed_net >= 0` _(value floor — belt-and-suspenders against a negative moving-average pool)_
   - Fail → `raise … using errcode='22023'` mapped in the UI to **"ของถูกเบิก/คืน/ปรับ pool ไปแล้ว — กลับรายการเบิกก่อน หรือใช้ตรวจนับ"**. Later _pure receipts_ of the same item do **not** trip this (they are additive at their own cost); only issue/return/count do.

On success (single txn):

- Insert `stock_receipt_corrections` (removed\_\* computed per §6; `supplier_id` copied from the receipt).
- `update stock_on_hand set qty_on_hand = qty_on_hand - removed_qty, total_value = total_value - removed_net` — subtract the **identical rounded `removed_net`** that GL credits to 1500 (keeps the reconciliation tie exact).
- If `p_request_id` given: `update receipt_correction_requests set status='applied', decided_by=auth.uid(), decided_at=now(), correction_id=…`.
- Write an `audit_log` row (`action` = a new `stock_receipt_correction` value; payload = receipt, ordered, true, removed, reason).
- Enqueue GL contra (via the insert trigger).
- Enqueue a notification to the flag's `requested_by` (correction applied).

## 6. GL contra rules

Own `source_table='stock_receipt_corrections'`, `source_event='stock_receipt_correction'`. Posted into the **current open period** (`current_date`), NOT the receipt's `entry_date` (else a post-month-close correction raises `P0002` and strands a `failed` outbox row while on-hand already dropped).

Amounts (VAT-residual — never round three legs independently):

```
removed_net   = round(removed_qty * receipt.unit_cost, 2)          -- unit_cost is NET
removed_vat   = round(removed_net * receipt.vat_rate/100, 2)  IF receipt.vat_rate > 0 else 0
removed_gross = removed_net + removed_vat                          -- residual
```

Journal lines:

```
Cr 1500 Inventory   removed_net     (project_id)
Cr 1300 Input VAT   removed_vat     ONLY IF receipt.vat_rate > 0
Dr 2100 AP          removed_gross   (supplier_id = receipt.supplier_id, may be null)   -- residual = Cr1500 + Cr1300
```

- **Zero-value skip:** if `removed_net = 0` (free/sample `unit_cost=0`) → post **no** journal entry (return null, exactly like `post_stock_count_to_gl`); a 0/0 line fails the engine's one-sided check.
- **Redrain self-guard:** the poster reverses-and-reposts its own prior non-reversed entry keyed on `(source_table, source_id, source_event)` so an overlapping drain (no `FOR UPDATE SKIP LOCKED`) self-heals — matches the `receipt_poster_redrain_guard` class and the planned `poster_guard_present` integrity check.
- **Do NOT reuse `post_stock_reversal_to_gl`** — it reverses **net only** (two lines, no 1300) and is itself a latent AP/VAT bug for VAT receipts.
- **Drain routing:** land the `drain_gl_posting` CASE for `stock_receipt_corrections` in the **same migration** as the enqueue trigger, name-matched to the enqueue's `source_table` string — else the job is marked `skipped` (which `posting_backlog_zero` does **not** count → silent drift).

## 7. Provenance branching (which receipts the correction accepts)

| Receipt origin                                                             | AP booked?                      | VAT leg | Correction behavior                     |
| -------------------------------------------------------------------------- | ------------------------------- | ------- | --------------------------------------- |
| PO-delivery, VAT (`vat_rate>0`)                                            | Cr 2100 gross                   | yes     | 3-leg contra (residual)                 |
| PO-delivery, zero-VAT                                                      | Cr 2100                         | no      | 2-leg `Cr 1500 / Dr 2100`               |
| `record_stock_in` / `_bulk` (manual, `vat_rate=0`, may have null supplier) | Cr 2100                         | no      | 2-leg; carry null supplier through      |
| `site_purchase_use_now`                                                    | Cr (cash proxy), on-hand nets 0 | —       | **REFUSE**                              |
| WP-bound PR                                                                | no receipt row                  | —       | N/A — out of scope, hidden from SA flag |

## 8. Concurrency & lifecycle

- **One open flag per receipt:** partial unique index (§4.1), not an exists-check.
- **Apply serialization:** `select … from receipt_correction_requests where id=p_request_id for update` + re-assert `status='pending'` before mutating (mirror `decide_identity_change`) — makes double-apply of one flag safe.
- **Surplus re-derived at apply** from the **immutable receipt** (`receipt.qty - p_true_qty`), never the flag's stored `proposed_qty` snapshot; re-checked after the `stock_on_hand FOR UPDATE`. A stale flag whose phantom was issued out in the meantime fails **closed** at the fresh-pool gate.
- **Cross-guard with `reverse_stock_receipt`:** `correct_stock_receipt` refuses a receipt that already has a `stock_reversals` row; `reverse_stock_receipt` gains a symmetric refusal for a receipt that already has a `stock_receipt_corrections` row (else the two double-remove the same receipt).
- **Dangling-flag auto-resolver:** when a receipt is reversed (`reverse_stock_receipt`) or its PR cancelled/voided, mark any `pending` `receipt_correction_requests` for that receipt `obsolete` (trigger or in-RPC). The BO queue must never accumulate un-actionable ghosts.
- **Re-flag-after-reject:** a BO **reject** closes the receipt to further SA flags (no unbounded disagreement loop). Re-opening is a BO action.

## 9. Audit / notifications / integrity

- **Audit:** the correction writes an `audit_log` row — closing the current gap where stock reversals write **none**. (New `audit_action` enum value `stock_receipt_correction`.)
- **Attribution:** cite three identities — received = `stock_receipts.created_by` (⚠ falls back to `requested_by` on automated ingest; display as requester-fallback when `created_by = requested_by`), flagged = SA uid, corrected = BO uid.
- **Notifications:** flag raised → 🔔 procurement queue (`resolve-recipients` gains an event routed to the procurement/back-office pool). Correction applied/rejected → 🔔 the flag's `requested_by`.
- **Integrity (U7):** add an **`inventory_1500` tie** — `(Σ debit−credit where account=1500) = Σ stock_on_hand.total_value`, backlog-cleared — to the **scheduled** integrity registry (`_integrity_check_results`). Today the 1500 tie lives only in the role-gated `gl_reconciliation` (invoked from `/accounting`); the cron scan omits it, so a correction-induced drift would go unseen for weeks.

## 10. UI surfaces

### 10.1 SA flag — `รายงานว่าบันทึกผิด`

- On the receipt row in the project store "รับเข้าล่าสุด" list and the item timeline (`/projects/[projectId]/store` and `.../store/items/[catalogItemId]`).
- Opens a sheet: **true count** (numeric) + **reason** + **required live-camera photo** (`capture="environment"`, per spec 303).
- Creates the flag; the receipt shows **⚠ รอแก้ไข**; 🔔 procurement.
- **Fixes the dead-button bug:** today `แก้รายการที่บันทึกผิด` (full reverse) renders to the SA but the RPC rejects `site_admin` → permission error. Replace the SA-visible control with this flag; keep the reverse button **role-gated to BO** (`store-manager.tsx:334`).

### 10.2 BO correct + queue

- Procurement/PM/super/director see a **correction queue** (pending flags across their projects) and a **correct control** on any receipt.
- Reviewing a flag shows SA's proposed count + photo + the receipt's ordered qty and current on-hand.
- Actions: **apply** (partial correction), **reject** (+note). Fresh-pool failure surfaces the guide message (§5) rather than applying.
- Direct-correct (no flag) available on any eligible receipt.

## 11. Unit decomposition

Each unit ships via `ship-unit` (own PR, pgTAP RED-first, browser-verify, fresh-eyes review). GL/schema units are **danger-path** — operator-gated merge per the autonomous-build fence.

| Unit   | Scope                                                                                                                                     | Danger    | Key tests                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| **U1** | schema: 2 tables, indexes (incl. partial-unique pending), append-only + enqueue triggers, `audit_action` + notification event enum values | schema    | append-only blocks; one-pending uniqueness under concurrent insert                          |
| **U2** | `correct_stock_receipt` RPC: all §5 preconditions + fresh-pool gate                                                                       | schema/GL | range/origin/anti-join/fresh-pool/value-floor guards; cumulative cap; null-safe role gate   |
| **U3** | GL contra poster + drain CASE (same migration) + redrain self-guard; post to current period                                               | GL        | VAT-residual balances to satang; zero-value skip; redrain idempotency; closed-period safety |
| **U4** | flag RPCs `submit_receipt_correction_request` / `decide_…` (apply/reject) + lifecycle guards + auto-resolver                              | schema    | one-pending race; double-apply lock; reject-closes; dangling-flag → obsolete                |
| **U5** | BO correct UI + queue + notification routing                                                                                              | code      | apply/reject flows; fresh-pool guide message; role gating                                   |
| **U6** | SA flag UI + **dead-button fix** (role-gate the reverse control)                                                                          | code      | SA sees flag not reverse; photo required; ⚠ รอแก้ไข state                                   |
| **U7** | integrity: `inventory_1500` tie in the scheduled registry                                                                                 | schema    | drift injection caught by the cron check                                                    |

Suggested order: U1 → U2 → U3 → U4 → (U5 ∥ U6) → U7.

---

## Appendix A — Verified extreme-case register

Each row was reproduced against live migrations by an adversarial probe. "Guard" = where this design defends it.

| #   | Extreme case                                                                                           | Verdict           | Guard in this design                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| A1  | 3-arm VAT contra drifts a satang → unbalanced → outbox `failed` → on-hand dropped, GL stuck            | REAL              | §6 residual: `Dr2100 = Cr1500 + Cr1300`, never 3 independent roundings (`journal_posting_engine.sql:96`)      |
| A2  | Zero-cost (free/sample) or `true_qty==booked` → all-zero lines rejected `line must be one-sided`       | REAL              | §5.2 reject `removed=0`; §6 skip GL when `removed_net=0` (`journal_posting_engine.sql:75`)                    |
| A3  | Moving-avg pool: removing at receipt cost drives `total_value` negative while qty positive             | REAL              | §5 value floor `total_value - removed_net >= 0` + fresh-pool gate blocks post-issue                           |
| A4  | Multiple corrections escape the one-per-receipt index; cumulative removed > booked                     | GAP               | §4.2 own cumulative guard `Σremoved_qty ≤ qty`, `Σremoved_net ≤ total_cost` under lock                        |
| A5  | AP walk-back on the existing reversal poster reverses **net only**, strands Input VAT                  | REAL              | §6 dedicated 3-leg gross poster; do NOT reuse `post_stock_reversal_to_gl`                                     |
| A6  | Negative/out-of-range `true_qty` → negative credit line + inflated on-hand                             | GAP               | §5.2 hard-validate `0 ≤ true_qty < booked` before any write                                                   |
| A7  | Phantom issued to WP → WIP 1400 mis-costed; receipt contra can't repair WIP                            | REAL              | §3 dirty-pool OUT; §5 fresh-pool gate blocks once any issue drew the pool                                     |
| A8  | `on_hand ≥ surplus` unsound: later receipts/returns mask a consumed phantom (no receipt→issue trace)   | REAL              | §5 fresh-pool gate keys on issue/return/count since `received_at`, not just on-hand qty                       |
| A9  | Different-cost receipts make "proportional" contra unresolvable under moving-avg                       | GAP               | §6 pin contra to the receipt's own `unit_cost`; fresh-pool gate ensures no blended relief has occurred        |
| A10 | `reverse_stock_issue` (WIP unwind) excludes procurement + needs project membership                     | REAL              | §3 dirty-pool OUT (no auto-unwind); block + guide instead                                                     |
| A11 | `reverse_stock_issue` has no guard vs prior partial return → double-credit                             | REAL              | not relied upon — dirty-pool path is blocked, not unwound                                                     |
| A12 | `wp_profit` (informs client billing) keeps the phantom issue at sell                                   | REAL              | §3 documented residue; fresh-pool gate prevents reaching this state                                           |
| A13 | Phantom does NOT mechanically reach the client invoice (revenue operator-entered)                      | GUARDED           | reassuring bound — worst residue is WIP/wp_profit, contained (`post_client_billing_to_gl` posts no 1400/5xxx) |
| A14 | `site_purchase_use_now`: received+issued same txn, on-hand nets 0 → loots other stock or always blocks | REAL              | §5.3 / §7 refuse this origin                                                                                  |
| A15 | Already-reversed receipt → double-subtract / double-contra                                             | REAL              | §5.4 anti-join on `stock_reversals`; §8 cross-guard                                                           |
| A16 | Manual `record_stock_in` (`vat_rate=0`) → spurious `Cr 1300` if 3-leg assumed                          | GAP               | §6 VAT leg only when `receipt.vat_rate>0`; §7 2-leg for zero-VAT origins                                      |
| A17 | VAT receipt: AP credited **gross** but `total_cost` is **net** → naive contra under-walks AP           | GAP               | §6 split all legs from receipt net/vat/gross, not `total_cost`                                                |
| A18 | "Spawn remainder like split" unreachable (split refuses delivered PRs; manual receipts have no PR)     | GAP               | §2.4 close-short only; no remainder                                                                           |
| A19 | Null supplier on manual/use-now → AP line unattributable                                               | GAP               | §6 carry receipt's own `supplier_id` (preserve null); §7 refuse use-now                                       |
| A20 | Contra into a **closed** accounting period → `P0002` `failed`                                          | GAP               | §6 post to current open period (`current_date`)                                                               |
| A21 | New `source_table` enqueued but not routed → `skipped`, invisible to `posting_backlog_zero`            | GAP               | §6 drain CASE in same migration, name-matched                                                                 |
| A22 | `inventory_1500` tie absent from the scheduled scan                                                    | GAP               | §9 / U7 add it to the cron registry                                                                           |
| A23 | Overlapping drain (no `SKIP LOCKED`) double-posts                                                      | REAL              | §6 reverse-and-repost self-guard keyed on `(source_table, source_id, source_event)`                           |
| A24 | `reverse_stock_receipt` + `correct_stock_receipt` double-remove one receipt                            | REAL              | §8 mutual cross-guard                                                                                         |
| A25 | One-open-flag TOCTOU (template exists-check over non-unique btree)                                     | REAL              | §4.1 partial unique index `(receipt_id) where status='pending'`                                               |
| A26 | Two BO users apply the same flag                                                                       | GUARDED-by-design | §8 request-row `FOR UPDATE` + status re-check (mirror `decide_identity_change`)                               |
| A27 | NULL-role gate slip (`not in (...)` on NULL falls through)                                             | GUARDED-by-design | §5.1 `v_role is null or v_role not in (...)`                                                                  |
| A28 | Dangling flag after full-reverse / PR-cancel                                                           | GAP               | §8 auto-resolver → `obsolete`                                                                                 |
| A29 | Re-flag after reject = unbounded loop                                                                  | GAP               | §8 BO reject closes the receipt to further SA flags                                                           |
| A30 | Attribution: "who received" degrades to requester on automated ingest                                  | GAP               | §9 display `created_by` as requester-fallback when `= requested_by`                                           |
| A31 | Multi-line delivery: per-receipt is the honest grain (one truck → N receipts)                          | OUT               | §10 UX surfaces the N receipts; per-receipt flag, no dishonest bulk correct                                   |

## Appendix B — Deferred / future

- **Dirty-pool WIP repair.** A guided unwind (reverse dependent issues → then correct) would fix WIP 1400 + `wp_profit`, but it is a cross-role build (`reverse_stock_issue` is SITE_STAFF-only and membership-scoped; procurement can't call it) and must guard against prior partial returns. Deferred; today's answer is **block + guide** (reverse the เบิก first, or ตรวจนับ).
- **Over-received** (physically more than ordered). Needs a received-vs-ordered variance model the schema lacks today.
- **Lot / receipt-layer costing.** The root cause of the fresh-pool restriction is that `stock_on_hand` is a single moving-average pool with no per-receipt lots and `stock_issues` carries no `receipt_id`. A lot ledger would make late corrections sound, at significant cost.
