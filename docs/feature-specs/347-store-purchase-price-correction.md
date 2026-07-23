# Spec 347 — store-first purchase price correction (แก้ไขราคาซื้อผ่านสโตร์)

> **For agentic workers:** execute unit-by-unit with the `ship-unit` skill (lane claim →
> dependency gate-check → RED first → real-flow verify → fresh-eyes → gated ship). Each
> unit is its own PR. U1→U2 are one schema lane, strictly ordered.

**Goal:** a GL-correct way to fix a store-first purchase whose unit PRICE (or VAT rate)
was entered wrong — moving the inventory pool (`stock_on_hand.total_value`), the
inventory GL (1500/1300/2100), and every display surface to the true number, while the
frozen source rows stay frozen.

**Origin (why now):** spec 345 U4 (merged 2026-07-23, PR #708, mig `20260813075841`)
planned `correct_purchase_amount` as a plain `purchase_requests.amount` UPDATE relying
on the purchase→GL trigger to reverse-and-repost. A live probe killed it: the purchase
GL enqueue fires only `WHEN work_package_id IS NOT NULL AND status IN ('purchased',
'site_purchased')`, but effectively all live purchase money events are store-first
(`work_package_id` force-nulled, ADR 0065) — their money books as INVENTORY at receipt
off the `stock_receipt`, not off the PR row. A plain amount UPDATE would repost GL for
~0% of real purchases and only make the displayed amount disagree with the inventory it
created. It was deferred to this spec; purchases are flag-only in the spec-345 review
queue until this ships.

**Closest existing pattern (reuse, don't re-roll):** spec 324 `correct_stock_receipt`
— the QUANTITY correction. Same family: append-only correction ledger + fresh-pool
guard + pool adjustment + VAT-residual GL contra off an AFTER-INSERT enqueue + drain
CASE arm. This spec is its VALUE sibling. Where a guard below says "as 324", the
reference body is `correct_stock_receipt` in mig `20260813075841` (the live, widened
version — NOT the original `075810`).

## Operator decisions (locked 2026-07-23, brainstorm in chat)

1. **Fresh-pool only (v1).** Correct only receipts whose pool has not moved since
   receipt (no issue/return/count for that project+item since `received_at`) — 480/485
   live purchase receipts qualify. The already-issued tail (5 receipts) gets an honest
   refusal + guidance (reverse the issue first, or true the pool by stock count).
   Splitting a price delta between on-hand (1500) and already-issued WIP (1400) is
   designed OUT of v1.
2. **Role gate = the stock-correction set:** `is_back_office(role) OR role =
'accounting'`, with the membership exemption for
   `procurement / procurement_manager / accounting` — byte-identical to the live
   `correct_stock_receipt` gate after spec 345 U4. Same authority corrects qty and
   price.
3. **`purchase_requests.amount` is NEVER updated.** It stays the immutable
   "as-entered/approved" value. The correction lives in an append-only ledger; readers
   show **effective amount = `PR.amount` + Σ(delta_gross)**. This is load-bearing, not
   cosmetic — see invariant I-2.
4. **`vat_rate` corrects together with the amount** (they co-determine the 1500/1300
   split; wrong-VAT-flag is the same error family). Matches the deferred
   `correct_purchase_amount(p_purchase, p_amount, p_vat_rate, p_reason)` signature in
   the 345 plan.

## Evidence pinned 2026-07-23 (live DB probes, this spec's ground truth)

- **536 of 540** money-event purchases (`delivered/purchased/site_purchased/cancelled`)
  are wp-null = store-first. (The spec-345 U4 probe said 484/484; the table grew by the
  time of this spec's probe — the ratio is the point.) Breakdown of the 536: 485
  `delivered` (484 with receipts) · 49 `cancelled` (1 still carries a live receipt —
  correctable if never reversed, guard 5 handles the reversed case) · 2 `purchased`
  (pre-delivery, no receipt, nothing booked yet).
- ⚠️ **1 delivered wp-null PR is OFF-CATALOG** (`catalog_item_id` null):
  `stock_in_on_receive` skips it, so it has NO receipt, NO inventory, and NO GL entry —
  its money is booked nowhere. Pre-existing gap, out of this spec's scope (no receipt =
  no correction target; the door simply doesn't render). Surfaced to the operator as an
  observation beside this spec.
- **PR ↔ stock_receipt is strictly 1:1 today:** 485 receipts carry
  `purchase_request_id`, every PR has exactly one receipt (grouped count = 1 for all).
  No partial deliveries exist. Correcting a purchase's price = correcting its single
  receipt. (The unique index on `stock_receipts.purchase_request_id` is the idempotency
  guard in `purchase_requests_stock_in_on_receive`.)
- **480 of 485** purchase receipts are fresh-pool (no issue/return/count for that
  project+item since `received_at`) → v1 covers ~99% of live rows.
- `stock_receipts` is **frozen** (`stock_receipts_no_update_delete` BEFORE UPDATE OR
  DELETE + `_no_truncate`), and `total_cost` is **GENERATED ALWAYS AS (qty \*
  unit_cost)**. The corrected value can NOT be written onto the receipt — it must live
  in a ledger.
- `purchase_requests` is **in-place updatable** (no freeze trigger), but per decision 3
  we still never update it. Column inventory relevant here: `quantity`, `unit`,
  `amount` (GROSS, all-in), `vat_rate`, `catalog_item_id`, `supplier_id`,
  `work_package_id`, `requested_from_work_package_id`. There is **no unit-price
  column** — unit price is derived `amount / quantity`.
- **Receive-time money math** (`purchase_requests_stock_in_on_receive`, mig
  `20260813003500`): `net_total = round(amount / (1 + vat_rate/100), 2)`;
  `unit_cost = round(net_total / quantity, 2)`; pool `+= qty` and
  `+= qty * unit_cost`.
- **Receipt GL** (`post_stock_receipt_to_gl`, live): Dr 1500 net (= receipt
  `total_cost`) / Dr 1300 Input VAT / Cr 2100 gross — where **gross is read from the
  originating `purchase_requests.amount` AT DRAIN TIME** (AP must equal the invoice
  exactly; VAT is the residual gross − net).
- **Issue GL** (`post_stock_issue_to_gl`, live): Dr 1400 (WIP, per WP) / Cr 1500 at the
  issue's `total_cost` — this is where an already-issued price error has leaked, and
  why v1 refuses those.
- **Integrity tie** (`gl_reconciliation()` + `_integrity_check_results()`, mig
  `20260813075813`): GL 1500 = Σ `stock_on_hand.total_value` + Σ(po_charge on 1500),
  pending-gated on an explicit `source_table IN (…)` list of 1500-affecting posters.
  ⚠️ A wrong price overstates BOTH sides of this tie equally, so **the error is
  invisible to every integrity check** — only the spec-345 human review catches it.
  That is why this correction exists and why it must keep the tie intact.
- **Spec-345 review layer** (migs `075838`–`075841`): purchases are reviewed under
  `money_event_reviews (source_table='purchase_requests', source_id=PR.id)`;
  `money_review_flags.flag_type='amount_mismatch'` is the flag a reviewer raises today;
  the stale trigger `purchase_requests_money_review_stale` fires only on a PR UPDATE —
  which per decision 3 never happens → the review tie-in must be explicit (I-5).
- `stock_receipt_corrections` (spec 324) already has an AFTER INSERT stale trigger
  keyed `('stock_receipts', 'receipt_id')`; the new ledger mirrors that wiring.
- No price-correction RPC of any name exists at HEAD (probed `pg_proc`).
- Drain: `drain_gl_posting` CASE dispatches on `source_table`; an unknown value marks
  the job `skipped` silently — the new arm must be name-matched to the new table.
- Migration head at spec time `20260813075841`; **build lanes claim their own numbers
  at build time** (LANES.md, `require-lane-claim` hook) — this spec claims none.

## Invariants (each becomes at least one RED-first test)

- **I-1 — The 1500↔pool tie survives every correction:** each correction moves GL 1500
  by exactly `delta_net` and `stock_on_hand.total_value` by exactly the same
  `delta_net` (one rounded number used for both, the 324 discipline). After any
  sequence of corrections, `gl_reconciliation()`'s `inventory_1500` row is green once
  the outbox drains.
- **I-2 — `purchase_requests.amount` is immutable under this feature.** Load-bearing:
  `post_stock_receipt_to_gl` reads gross from `PR.amount` at drain time and is
  reverse-and-repost. If we updated `PR.amount`, any later re-post of the receipt would
  book the NEW gross against the frozen `total_cost` net while our contra still stands
  — a silent double-correction. Because `PR.amount` never changes, a receipt re-post
  reproduces the ORIGINAL entry and the correction contra composes on top, exactly
  once. (Also: no PR UPDATE ⇒ the GL enqueue, `stock_in_on_receive`, and notify
  triggers on `purchase_requests` provably never fire from this feature.)
- **I-3 — Corrections compose:** effective gross = `PR.amount` + Σ `delta_gross` over
  the receipt's correction rows; after correction N the effective gross equals row N's
  `corrected_amount` exactly. Same for net (receipt `total_cost` + Σ `delta_net`) and
  VAT (residual). A second correction's deltas are computed against the PRIOR effective
  values, never against the original.
- **I-4 — Signed, both directions:** price too HIGH (deltas negative: Cr 1500 / Cr 1300
  / Dr 2100) and too LOW (deltas positive: Dr / Dr / Cr) both work. A rate-only
  correction (same gross, different VAT rate) posts a two-line 1500↔1300 entry with no
  2100 leg.
- **I-5 — The spec-345 review reacts explicitly:** a correction flips a `verified`
  review on `('purchase_requests', PR.id)` back to `pending` (+ the standard
  `changed_after_verified` system flag), and — when called from a flag — resolves that
  flag. Verification itself stays a human act; the RPC never writes `verified`.
- **I-6 — Mutual exclusion with the qty family, BOTH directions:** a receipt with any
  `stock_receipt_corrections` row refuses price correction; a receipt with any
  `stock_receipt_price_corrections` row refuses `correct_stock_receipt` AND
  `reverse_stock_receipt`. Why hard: 324 removes qty at the frozen `unit_cost` and
  reverses at the frozen `total_cost` — after a price correction both would move the
  pool at a stale cost, a silent satang leak. (Escape hatch for a receipt that is wrong
  in BOTH qty and price: `reverse_stock_receipt` the whole receipt — which stays
  possible because reversal is checked BEFORE any price correction exists — then
  re-deliver correctly.)
- **I-7 — VAT-residual rounding, never three independent roundings:**
  `corrected_net = round(corrected_amount / (1 + corrected_vat_rate/100), 2)`;
  `corrected_vat = corrected_amount − corrected_net`. Deltas are differences of such
  pairs, so `delta_gross = delta_net + delta_vat` holds by construction — a satang
  imbalance would make `post_journal_internal` raise and strand a `failed` outbox row
  while the pool already moved (the 324 U3 lesson, verbatim).

## Worked example (fact-checkable arithmetic)

Purchase entered: 100 units, `amount` ฿10,700, `vat_rate` 7 → receipt `unit_cost`
100.00, `total_cost` 10,000.00; GL Dr 1500 10,000 / Dr 1300 700 / Cr 2100 10,700; pool
value +10,000.

Invoice actually says ฿9,630 → `correct_purchase_price(receipt, 9630, 7, 'พิมพ์ราคาผิด')`:
corrected_net = round(9630/1.07, 2) = 9,000.00; corrected_vat = 630.00.
Deltas: net −1,000.00 · vat −70.00 · gross −1,070.00.
Contra: Cr 1500 1,000 / Cr 1300 70 / Dr 2100 1,070. Pool value −1,000 (qty untouched).
Effective amount = 10,700 − 1,070 = 9,630 ✓. `PR.amount` still reads 10,700; every
surface shows ฿9,630 + a "แก้ไขราคาแล้ว" chip.

Rate-only variant: entered `vat_rate` 0 on a ฿10,700 VAT invoice →
`correct_purchase_price(receipt, 10700, 7, …)`: deltas net −700 · vat +700 · gross 0.
Contra: Cr 1500 700 / Dr 1300 700 (no 2100 leg — AP was already invoice-exact).

## File map (whole spec)

| Unit | Files                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1   | mig `spec347u1_price_correction_schema.sql` (table + freeze + enqueue + poster + drain arm + integrity lists + stale trigger) · pgTAP `347-price-correction-schema.test.sql` |
| U2   | mig `spec347u2_correct_purchase_price.sql` (RPC + reciprocal guards in `correct_stock_receipt`/`reverse_stock_receipt`) · pgTAP `347b-correct-purchase-price.test.sql`       |
| U3   | voucher แก้ไขราคา action in `src/app/accounting/review/[source]/[id]/` (+ server action) · labels · RTL                                                                      |
| U4   | `purchaseEffectiveAmount` SSOT + read sweep (purchases list, PR detail, review queue/voucher) + chip · RTL + mutation checks                                                 |

---

## U1 — ledger + complete GL plumbing (schema; danger-path migration)

**Ordering constraint (the 324 U2/U3 lesson, inverted deliberately):** ALL GL plumbing
ships in U1, BEFORE the RPC exists. There must never be a live window where the pool
can move without its contra enqueued. U1 alone is inert (nothing inserts into the
table); U2 activates it.

**Table `stock_receipt_price_corrections`** (append-only; freeze triggers mirror
`stock_receipts_block_mutation` shape):

```sql
id uuid pk default gen_random_uuid(),
receipt_id uuid not null references stock_receipts(id),
corrected_amount   numeric not null,  -- the new GROSS (what the invoice really says)
corrected_vat_rate numeric not null,
delta_net   numeric not null,         -- signed, vs prior effective
delta_vat   numeric not null,
delta_gross numeric not null,
reason text not null,
flag_id uuid references money_review_flags(id),
supplier_id uuid references suppliers(id),
corrected_by uuid references users(id),
corrected_at timestamptz not null default now(),
check (delta_gross = delta_net + delta_vat),
check (corrected_amount > 0),
check (delta_net <> 0 or delta_vat <> 0)   -- a no-op row may not exist
```

Posture: RLS on, `revoke all … from public, anon, authenticated`, **no policies** —
DEFINER-only, exactly like `stock_receipt_corrections` / the 345 review tables. Index
on `receipt_id`.

**GL poster `post_stock_receipt_price_correction_to_gl(p_source_id uuid)`** — signed,
only nonzero legs:

- `delta_net > 0` → line `{1500, debit, delta_net, project_id}`; `< 0` → credit
  `abs(delta_net)`. Same for 1300 with `delta_vat`. `delta_gross` on 2100 with the
  supplier dimension, direction mirrored (positive delta_gross = MORE owed = credit
  2100). Skip any zero-delta leg entirely (a 0/0 line fails the engine's one-sided
  check).
- Posted `current_date` (open period — a post-month-close correction into the receipt's
  period would P0002 → strand a failed outbox row while the pool already moved; 324 U3
  verbatim).
- Reverse-and-repost self-guard keyed
  `('stock_receipt_price_corrections', p_source_id, 'purchase_price_correction')` — the
  redrain-guard class.
- `revoke all … from public, anon, authenticated` (drain calls it as owner).

**Enqueue:** `AFTER INSERT ON stock_receipt_price_corrections FOR EACH ROW EXECUTE
enqueue_gl_posting_tg('purchase_price_correction', 'id')`.

**Drain:** add CASE arm `when 'stock_receipt_price_corrections' then …` to
`drain_gl_posting` (live-sourced body + one arm, the 324 discipline). Name-match the
table string exactly — a mismatch silently marks jobs `skipped`, which
`posting_backlog_zero` does NOT count.

**Integrity registry (do not skip — U7's own comment demands it):** add
`'stock_receipt_price_corrections'` to the `inv_pending` `source_table IN (…)` list in
BOTH `gl_reconciliation()` AND `_integrity_check_results()` (live-sourced bodies, one
list edit each). Without this an in-flight correction flashes the `inventory_1500` tie
red for a scan cycle.

**Stale trigger:** `AFTER INSERT ON stock_receipt_price_corrections FOR EACH ROW
EXECUTE money_review_mark_stale_tg('stock_receipts', 'receipt_id')` — parity with the
qty ledger's wiring. (The `purchase_requests` review flip is the RPC's job, U2 —
a receipt-keyed trigger cannot reach it generically.)

**Gate-check before building (live):** `stock_receipts` freeze triggers + generated
`total_cost` still present · `enqueue_gl_posting_tg` signature ·
`money_review_mark_stale_tg` exists with the `(source_table, id_col)` convention ·
current bodies of `drain_gl_posting`, `gl_reconciliation`, `_integrity_check_results`
(source from LIVE via `pg_get_functiondef`, never from a migration file) · migration
head + LANES claim.

**pgTAP (RED first):** table exists/columns/CHECKs · freeze triggers raise P0001 on
UPDATE/DELETE · zero-grant posture (anon + authenticated INSERT refused) · enqueue
trigger row lands in `gl_posting_outbox` with the right source_table · poster posts the
worked example's contra (both sign directions + rate-only two-liner) · drain routes the
new source_table (not `skipped`) · `inv_pending` lists in both integrity functions
contain the new table (assert via `pg_get_functiondef` LIKE) · stale trigger flips a
verified `stock_receipts` review to pending.

**Negative cases / errors / recovery (schema layer):** direct table INSERT by
authenticated → `42501` (permission denied; recovery: none — use the U2 RPC). UPDATE/
DELETE on a correction row → `P0001` (append-only; recovery: a wrong correction is
fixed by issuing ANOTHER correction with the right `corrected_amount`).

---

## U2 — `correct_purchase_price` RPC + reciprocal guards (schema; danger-path, money)

**Signature:**

```sql
correct_purchase_price(
  p_receipt_id uuid,
  p_corrected_amount numeric,      -- new GROSS
  p_corrected_vat_rate numeric,
  p_reason text,
  p_flag_id uuid default null      -- money_review_flags.id when applied from the voucher
) returns uuid                     -- the correction row id
security definer, search_path=public
```

Grants: `revoke all … from public, anon; grant execute … to authenticated` (the house
RPC posture — internal gates do the work).

**Guard order (mirror `correct_stock_receipt` verbatim where shared; deltas noted):**

1. Role: `v_role is null or not (is_back_office(v_role) or v_role = 'accounting')` → 42501. Reason required (btrim-null) → P0001. `p_corrected_amount > 0` and
   `p_corrected_vat_rate >= 0` → P0001.
2. Load the frozen receipt. Unknown id → 22023. **Require `purchase_request_id is not
null`** → P0001 (v1 scope = purchase receipts; manual stock-ins are out — no PR
   gross to correct against).
3. Membership: `can_see_project(v_project) or v_role in ('procurement',
'procurement_manager', 'accounting')` → 42501. (345-U4 shape — accounting needs the
   exemption because `can_see_project(accounting) = false`.)
4. Use-now refuse: `note = 'ซื้อใช้หน้างาน'` → P0001 (fresh-pool gate backstops a
   custom-note use-now via its coincident issue).
5. Already reversed (`stock_reversals.receipt_id` exists) → P0001.
6. **Mutual guard:** any `stock_receipt_corrections` row for this receipt → P0001
   (I-6).
7. Lock the pool row `FOR UPDATE` (serializes all corrections for the
   project+item, including concurrent price corrections of the same receipt —
   the deltas-vs-effective read happens under this lock). Missing pool row → 22023.
8. **Fresh-pool window** — the same three EXISTS as 324 (issues / returns / counts
   since `received_at`) → 22023 with the U2 Thai message below.
9. Compute under the lock: effective net = receipt `total_cost` + Σ prior `delta_net`;
   effective gross = PR `amount` + Σ prior `delta_gross`. New split per I-7. Deltas =
   new − effective. All three zero → P0001 ("nothing to correct").
10. Floor: `total_value + delta_net >= 0` → 22023 (a negative pool value must be
    impossible).
11. Writes: INSERT the correction row (enqueue + stale triggers fire) → UPDATE pool
    `total_value += delta_net` (qty untouched) — same rounded `delta_net` in both
    places (I-1).
12. **Review tie-in (I-5):** flip `money_event_reviews ('purchase_requests', v_pr)`
    from `verified` to `pending` + insert the standard `changed_after_verified`
    suggested system flag (same shape as `money_review_mark_stale_tg` — done in-RPC
    because no trigger on the PR fires). If `p_flag_id` given: lock the flag row,
    re-assert it is still resolvable (else P0001 — the 324 double-apply shape; the
    accepted status set is `open`, plus `suggested` only if the live 345-U3 resolve RPC
    accepts it — gate-check at build time), then resolve it (`status='resolved'`,
    `resolved_by/at`, `resolution = p_reason`).
13. Audit: `action='other'`, `payload->>'event'='purchase_price_corrected'` +
    `receipt_id, purchase_request_id, corrected_amount, corrected_vat_rate, delta_net,
delta_vat, delta_gross, reason, flag_id` (lane-344/345 convention — no
    `audit_action` enum add, so no enum-pin guard trips). ⚠️ Gate-check the audit_log
    READER RLS at build time: accounting sits in the privileged read-all arm (345 plan
    D-3, probed 2026-07-23) — re-verify, since `other` events are only visible to that
    arm.

**Reciprocal guards (edits to two LIVE money RPC bodies — 345-U4 discipline:
live-sourced verbatim, ONLY the named guard added, byte-diff proof in the PR):**

- `correct_stock_receipt`: after its reversal check, add — any
  `stock_receipt_price_corrections` row for the receipt → P0001 (Thai below).
- `reverse_stock_receipt`: extend its mutual guard the same way. NOTE: reversal
  currently subtracts the frozen `total_cost` from the pool; after a price correction
  that constant is stale — the guard makes that state unreachable instead of handling
  it.

**Gate-check before building (live):** `pg_get_functiondef` of `correct_stock_receipt`

- `reverse_stock_receipt` (bodies moved at `075841` — source from live, NOT `075810`) ·
  `money_event_reviews` / `money_review_flags` column shapes + flag-status enum ·
  `is_back_office` membership · pool table shape · U1's objects live.

**pgTAP (RED first) — minimum set:** the worked example end-to-end (deltas, pool value,
outbox row; drain → journal lines Cr1500 1000/Cr1300 70/Dr2100 1070) · upward
correction (signs flip) · rate-only (two-line entry, no 2100) · compose (two
corrections land exactly on the second `corrected_amount`; I-3) · every refusal above
(`throws_ok` with errcode AND message — the three 42501 arms need message pins, the
337-U5b lesson) · mutual guard BOTH directions (price-then-qty refused, qty-then-price
refused, price-then-reverse refused) · floor breach · zero-delta refusal ·
flag resolve path incl. non-open flag refusal · review flip + system flag row ·
`role=authenticated` probes (needs the `_tap_buf` grant — memory
`pgtap-tapbuf-grant-role-switch`) · audit row shape. **Never assert exact values on
operator-editable rows** (337-U5b) — build fixtures, don't lean on live data.

**Negative cases / Thai errors / recovery (binding per specs README):**

| Mode                                    | errcode | Message (exact)                                                                                                    | Recovery                                                                |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| role not permitted                      | 42501   | `correct_purchase_price: role not permitted`                                                                       | surface as generic no-permission toast; only back-office/accounting act |
| not a project member                    | 42501   | `correct_purchase_price: not a project member`                                                                     | PM asks procurement/accounting to apply                                 |
| blank reason                            | P0001   | `correct_purchase_price: reason required`                                                                          | UI requires the field before submit                                     |
| bad amount/rate                         | P0001   | `correct_purchase_price: corrected amount must be > 0`                                                             | fix input                                                               |
| unknown receipt                         | 22023   | `correct_purchase_price: unknown receipt`                                                                          | stale link — refresh voucher                                            |
| no PR (manual stock-in)                 | P0001   | `correct_purchase_price: ไม่ใช่ใบรับจากคำขอซื้อ — แก้ไขได้เฉพาะรับเข้าจากการซื้อ`                                  | manual receipts: reverse + re-record                                    |
| use-now receipt                         | P0001   | `correct_purchase_price: ไม่รองรับใบรับแบบซื้อใช้หน้างาน`                                                          | of-record via reversal path                                             |
| already reversed                        | P0001   | `correct_purchase_price: receipt already reversed`                                                                 | nothing to correct — the reversal unwound it                            |
| qty-corrected before                    | P0001   | `correct_purchase_price: ใบรับนี้เคยแก้ไขจำนวนแล้ว — แก้ไขราคาไม่ได้ ให้กลับรายการรับเข้าแล้วบันทึกใหม่`           | reverse + re-deliver                                                    |
| pool moved (issued tail)                | 22023   | `correct_purchase_price: ของถูกเบิก/คืน/ปรับ pool ไปแล้ว — แก้ไขราคาไม่ได้ กลับรายการเบิกก่อน หรือปรับด้วยตรวจนับ` | reverse the issue then correct, or stock-count the value                |
| zero delta                              | P0001   | `correct_purchase_price: ราคาใหม่เท่ากับราคาปัจจุบัน — ไม่มีรายการต้องแก้ไข`                                       | nothing to do                                                           |
| pool value floor                        | 22023   | `correct_purchase_price: on-hand value below removal net`                                                          | correction larger than pool — investigate qty first                     |
| flag not open                           | P0001   | `correct_purchase_price: flag is not open`                                                                         | flag already handled — refresh queue                                    |
| reciprocal (in `correct_stock_receipt`) | P0001   | `correct_stock_receipt: ใบรับนี้เคยแก้ไขราคาแล้ว — แก้ไขจำนวนไม่ได้ ให้กลับรายการรับเข้าแล้วบันทึกใหม่`            | reverse + re-deliver                                                    |
| reciprocal (in `reverse_stock_receipt`) | P0001   | `reverse_stock_receipt: receipt already price-corrected, cannot reverse`                                           | operator escalation (break-glass class)                                 |

Raw Postgres text never reaches the user: the U3 server action maps errcodes/messages
to labels (house rule).

---

## U3 — voucher แก้ไขราคา action (code; touches `src/app/accounting/review/**`)

The spec-345 purchase voucher (`/accounting/review/purchase_requests/[id]`) gains the
correction door — this is the "real `correct_purchase_amount`" the 345 audit queue was
waiting for:

- On a purchase voucher, alongside the U3/U4 actions (ตรวจผ่าน / ติดธง / ปัดตก):
  **แก้ไขราคา** opens a bottom-sheet form — corrected gross amount (default = current
  effective), corrected `vat_rate` (default = current), reason (required). Submits a
  server action calling `correct_purchase_price` with the receipt id resolved from
  `stock_receipts.purchase_request_id = PR.id` (the 1:1 mapping; if no receipt exists —
  PR not yet delivered — the door does not render: pre-delivery there is no inventory
  to correct, and the PR is still editable upstream).
- When opened FROM an open `amount_mismatch` flag, pass that flag's id → the RPC
  resolves it atomically.
- After success: voucher re-renders showing effective amount + the correction history
  (each row: original → corrected, Δ, reason, who, when — read via a DEFINER read
  function or the voucher's existing service reads; the ledger is zero-grant).
- Refusal messages surface as Thai toasts per the U2 table (mapped in the action, keyed
  on the RPC message prefix — never raw).
- Labels used on 2+ surfaces (`แก้ไขราคา`, `แก้ไขราคาแล้ว`, the refusal toasts shared
  with U4's chip detail) single-source in `src/lib/i18n/labels.ts`.

**Gate-check:** the voucher component tree at HEAD (345 U3/U4 shipped days ago — read
the real files, not the plan) · `MONEY_REVIEW_ROLES` render gates · how existing
correction actions (e.g. wage supersede) mount their sheets — mirror that pattern.

**Tests (RTL, RED first):** door renders for accounting on a delivered store-first
purchase voucher · hidden when no receipt · form requires reason · success path calls
the action with the receipt id + flag id · refusal toast mapping (at least the
fresh-pool and mutual-guard arms) · mutation-check the render gate (remove the role
gate → a test must red — select the lens explicitly, the spec-340 lesson).

**Negative cases (UI):** RPC refusal → Thai toast, form stays open with values ·
network failure → generic retry toast · double-submit → disabled while pending; the
RPC's zero-delta refusal is the idempotency backstop.

---

## U4 — effective-amount read layer + chip (code)

**SSOT:** one helper (TS side, e.g. `src/lib/purchasing/effective-amount.ts` —
placement decided at build time next to the existing purchase read modules):
`effectiveAmount(pr, corrections) = pr.amount + Σ delta_gross`, plus
`effectiveVatRate` (= last correction's `corrected_vat_rate`, else the PR's). SQL-side
reads (the U2 review-queue RPC's docs-expected amounts) compute the same sum in the
query. Never re-roll the arithmetic per surface (money-format-SSOT doctrine).

**Surfaces (v1, binding):**

1. Spec-345 review queue rows + purchase voucher: show effective amount; original
   struck-through on the voucher with the correction history block (U3).
2. Purchases list + PR detail (procurement surfaces): effective amount + a
   `แก้ไขราคาแล้ว` chip when corrections exist; chip opens/links the correction detail
   (reason · who · when · original → corrected). The chip is the §2 signal rule: a
   number that silently changed is a support ticket.

**Dashboard / WP-spend rollups — verify, don't build:** store-first purchase money
reaches dashboards through the stock/GL layer, which the contra already corrects. Build
task: grep every reader of `purchase_requests.amount` (and any RPC summing it), classify
each as (a) PR-display → swap to effective, (b) stock/GL-derived → already correct,
zero work. Only if some rollup sums raw `PR.amount` does it join the sweep — list the
classification in the PR description. (Candidates to check, from memory
`prc-ops-dashboard-spend-model`: the wpLevel/projectPool split readers; store on-hand
detail's receipt history `unit_cost` — effective unit cost = (`total_cost` +
Σ`delta_net`) / `qty` — chip there is a nice-to-have, explicitly deferrable.)

**Tests:** helper arithmetic (compose, both signs, rate-only) · each swapped surface
renders effective not raw (fixture with a correction; assert the ฿9,630 not the
฿10,700 — and pin the ABSENCE of the raw string, mutation-checked) · chip renders only
when corrections exist · empty state (no corrections → no chip, raw amount unchanged).

**Negative cases (UI):** corrections unreadable (zero-grant ledger, read via DEFINER /
service read) → fall back to raw amount + NO chip is FORBIDDEN — the read must be part
of the same loader; if the loader fails the page errors honestly rather than showing a
stale number as truth.

---

## Out of scope (v1, decided)

- **Already-issued receipts (5/485):** refusal + guidance. Revisit only if the tail
  bites (splitting a delta into per-WP 1400 via moving-average attribution is lossy by
  construction).
- **Qty + price both wrong:** `reverse_stock_receipt` → re-deliver (guarded order:
  reversal must precede any price correction, I-6).
- **Manual stock-in (`record_stock_in`) price errors:** no PR gross exists; mechanism
  extends later if demanded (`purchase_request_id` gate is the seam).
- **PEAK export interaction:** the contra is a normal journal entry; spec 149 U8 owns
  export semantics.
- **Backfilling the 5 issued receipts or any historical price audit:** the 345 review
  queue is the discovery tool; corrections happen one-by-one with human reasons.

## Build-time guard-trip checklist (memory `prc-ops-guard-trip-map`)

- New pgTAP files → plan-count discipline (`1..N` header exact).
- New RLS-enabled table → `rls_enabled_all_tables` / zero-policy posture matches the
  sealed-table precedent (324/345) — the "every RLS table has a policy" integrity row
  is `implemented=false` today; re-check at build.
- `labels.ts` additions → additive only; serialize with any concurrent labels lane.
- New component folder under `review/` → component-location guard.
- NO `audit_action` enum add (uses `other`) — enum pins untouched.
- The two integrity-function edits are live-sourced bodies: re-source at build time,
  never from this spec or old migrations.
