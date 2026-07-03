# Spec 260 — PO-level charges: transport, discount, other (ค่าขนส่ง / ส่วนลด / ค่าใช้จ่ายอื่น)

**Status:** DRAFT (2026-07-04) — build order: this spec ships BEFORE spec 262
(reports); report totals are wrong without it.
**Origin:** Procurement team — "each PO often comes with (1) transportation
cost, (2) discounts, (3) other charges; we must be able to add these at PO
level." Today this money is invisible: `purchase_orders` carries **no money
column at all** (the PO total is `purchaseOrderTotal()` in
`src/lib/purchasing/purchase-order.ts`, a TS sum over member
`purchase_requests.amount`), so transport/discount either gets smuggled into a
line's `amount` (corrupting unit-price history, `item_price_history`) or lives
outside the app entirely.

**Relates:** ADR 0038/0044 (purchase write path — RPC is the only writer),
ADR 0045 (`amount` = GROSS incl VAT), ADR 0057 (GL outbox), spec 259 (void PO
must undo charges too), spec 135 (`purchase_order_deliveries.cost` — see §
"Existing `deliveries.cost`" below).

## Data model

New table `purchase_order_charges` — ordinary mutable table (NOT append-only),
same posture as `purchase_orders` itself: RPCs are the only writers, no direct
INSERT/UPDATE/DELETE policies.

| column              | type                                        | notes                                             |
| ------------------- | ------------------------------------------- | ------------------------------------------------- |
| `id`                | uuid PK default gen_random_uuid()           |                                                   |
| `purchase_order_id` | uuid NOT NULL FK → purchase_orders          | `on delete cascade` (void PO cleans up)           |
| `charge_type`       | enum `po_charge_type`                       | `transport` \| `discount` \| `other`              |
| `amount`            | numeric NOT NULL CHECK (amount > 0)         | GROSS incl VAT (ADR 0045 convention), **always positive** — `discount` subtracts by type, never by sign (no negative-entry mistakes) |
| `vat_rate`          | numeric(5,2) NOT NULL DEFAULT 0             | same semantics as `purchase_requests.vat_rate`    |
| `note`              | text                                        | required for `other` (CHECK), optional otherwise  |
| `created_by`        | uuid NOT NULL FK → users                    |                                                   |
| `created_at`        | timestamptz NOT NULL default now()          |                                                   |

No `updated_at` — charges are **add/void only, never edited in place** (see
"Why no edit" below). RLS: SELECT for the roles that can see the PO (same read
policy shape as `purchase_orders`); no write policies (RPC-only).

**PO total becomes:** `sum(member amounts) + sum(transport) + sum(other) −
sum(discount)`. `purchaseOrderTotal()` (`purchase-order.ts:125` — a pure
line-sum over `lineAmounts`, no PO id, no charges) **stays as-is**; a new
charges-aware `purchaseOrderGrandTotal(lineAmounts, charges)` lands beside it
in the same module (money-format SSOT), and the composition layer switches to
it: `buildPoDetailView` (`po-detail.ts`) and the worklist group rows. The
create sheet keeps the pure line-sum (no charge rows exist at that point in
the form) and previews the grand total client-side as charge rows are typed.

**Dashboard spend model (in scope — coherence requirement):**
`sumMaterials`/`spendBreakdown` (`src/lib/dashboard/spend.ts`) sum only
`purchase_requests.amount`; once charges are real committed spend the
dashboard budget bars would silently understate. This spec folds charges into
the dashboard spend model — allocated per-project by the same proportional
rule below, discount subtracting — with unit tests asserting dashboard total
= Σ line amounts + Σ allocated charges for a mixed fixture. (Spec 262's
report reads charges via its own RPC; this keeps the two surfaces in
agreement on charge inclusion.)

## RPCs

```
add_purchase_order_charge(p_po_id uuid, p_charge_type po_charge_type,
                          p_amount numeric, p_vat_rate numeric, p_note text)
  returns uuid
void_purchase_order_charge(p_charge_id uuid) returns void
```

- **`add` role gate:** `project_manager | procurement | super_admin |
  project_director` — identical to `create_purchase_order` (ADR 0044 §4 +
  ADR 0058 completeness: PD included). Whoever bundles the PO records its
  charges.
- **`add` state guard:** PO must still have at least one member not yet
  `delivered`… no — simpler and safer: charges may be added at any time before
  the PO is voided (late carrier invoices are normal). No state guard beyond
  PO existence.
- **`void` role gate:** `is_manager()` (= project_manager / super_admin /
  project_director — that is the whole tier, no union needed) for v1. Spec
  261 adds `procurement_manager` to this gate when that role lands.
  Rationale: adding a charge is routine data entry; removing one un-books
  recorded money — the manager-only class the operator defined ("cancelling
  is manager-only").
- **`void` behaviour:** look up the posted, not-yet-reversed
  `journal_entries` row for `(source_table='purchase_order_charges',
  source_id=<charge>, source_event='po_charge')` and pass its **entry id** to
  `reverse_journal_internal(p_entry_id, p_posted_by, p_memo)` — the
  look-up-then-reverse pattern `void_purchase_order` already uses; else mark
  the pending/posting outbox job `skipped` (mutually exclusive per charge —
  spec 259 / spec 198 U2), then DELETE the charge row. One `audit_log` row
  `po_charge_void` with `{po_number, charge_type, amount}` captured before
  delete.
- `add` writes one `audit_log` row `po_charge_add`.
- **Audit enum first:** `po_charge_add` / `po_charge_void` are new
  `audit_action` enum values — they get their **own migration, ordered before
  the RPC migration** (a new enum value is unusable inside the transaction
  that adds it; mirror `20260813069000`, spec 259's `purchase_order_void`
  registration).

### Why no edit

An edit of posted money is reverse+repost — exactly the
supersede-then-reset-job double-post class the GL re-drain guard exists for
(memory: gl-poster-redrain-guard-2026-07). Add/void composes the same outcome
(void wrong charge, add correct one) with zero new GL machinery and a cleaner
audit trail. Edit-in-place is explicitly out of scope.

## GL posting — recommended policy (🔔 operator may veto)

Precedent: for spec 251 the operator chose direct posting over accrual purity.
Same spirit here — **one journal entry per charge**, through the existing
outbox machinery. The exact plumbing (verified against the LIVE drain):

- **Enqueue:** AFTER-INSERT trigger on `purchase_order_charges` — the
  established `enqueue_gl_posting_tg` pattern (`source_table` is always
  `tg_table_name`), `source_event = 'po_charge'`. The trigger enqueues; the
  RPC does not touch the outbox directly.
- **Poster:** new `post_purchase_order_charge_to_gl(uuid)` builds the entry.
- **Drain:** `drain_gl_posting` dispatches on a **`source_table` CASE whose
  else-arm skips unknown tables** — without a new
  `when 'purchase_order_charges' then …` arm every charge job would be
  silently skipped and never post. DROP+CREATE of the drain **sourced from
  the LIVE proc** (currently the spec-178 store version `20260809001900`,
  NOT the original `20260743000200` — the GL-drain re-source lesson applies
  verbatim), with grep pins so a future replace can't drop the arm.

Entry shape:

- **transport / other** (landed cost, part of what we owe the supplier):
  `Dr 1400 WIP (net, WP-bound share — tagged project_id + work_package_id)
  / Dr 1500 Inventory (net, store-bound share — tagged project_id only;
  `journal_lines` has **no store/BU dimension column**, matching
  `post_stock_receipt_to_gl`) + Dr 1300 Input VAT (if vat_rate > 0) /
  Cr 2100 AP` — the Dr side is **allocated proportionally over the PO's
  member lines by line net amount**. Rounding: `round2` per share, remainder
  to the largest share (same exact-sum discipline as
  `split_purchase_request_on_receipt`).
- **discount**: the contra entry — `Dr 2100 AP / Cr 1400·1500 (net,
  same allocation) + Cr 1300 Input VAT (if vat_rate > 0)`.

This unit is a **danger-path (money/GL) migration → the PR is guard-held for
the operator** per the autonomous-build fence; it does not auto-merge.

Known timing wrinkle, accepted for v1: store-bound **line** cost posts
Dr 1500 at stock receipt, but a charge's store-bound share posts at charge
creation — inventory value can lead goods arrival by days. Flagged, not
fixed: the alternative (defer charge posting until every member delivered)
adds a whole state machine for a wrinkle accounting can live with. If the
operator vetoes, the fallback policy is "post charge when PO fully received".

Void-PO integration: `void_purchase_order` (spec 259) additionally
reverses/skips every charge entry/job of the PO before deleting the PO row
(charges then cascade). pgTAP for spec 259 gains a charge case.

## Existing `purchase_order_deliveries.cost`

Spec 135 gave each delivery batch a `cost` (shipping fee) + `carrier`. It
never posts GL and never enters any total. **Left untouched by this spec** —
it remains courier metadata on the batch. The money-bearing truth for
transport is the new `transport` charge. Seam recorded: a later cleanup may
migrate/deprecate `deliveries.cost` once the team is on charges (do NOT
double-show both as money anywhere; reports read charges only).

## UI

- **PO create flow** (the create-PO sheet on `/requests`): after the line
  picker, an optional "ค่าใช้จ่ายระดับใบสั่งซื้อ" section — add rows of
  type (ค่าขนส่ง / ส่วนลด / อื่นๆ) + amount + VAT toggle + note. Submitted as
  `add_purchase_order_charge` calls right after `create_purchase_order`
  succeeds (same server action, sequential; a failed charge add surfaces as a
  form error on an otherwise-created PO — acceptable, charge can be re-added
  from PO detail).
- **PO detail** (`/requests/orders/[poId]`): charges list under the lines —
  each row: type label, note, amount (discount rendered as `− ฿…`), running
  PO grand total. "เพิ่มค่าใช้จ่าย" button for the create-gate roles;
  void (ลบ) icon per charge for the manager gate only, destructive confirm
  naming type + amount.
- Terms into `labels.ts` (UI term SSOT): ค่าขนส่ง / ส่วนลด / ค่าใช้จ่ายอื่น /
  ยอดรวมใบสั่งซื้อ.

## Out of scope

- Editing a charge in place (add/void composes it).
- Line-level discounts (a per-line price IS the line's `amount` — team asked
  PO-level).
- Migrating `purchase_order_deliveries.cost` (seam recorded above).
- Charge budgets/limits, approval thresholds.
- Reports consuming charges — spec 262 (which depends on this spec).
- **Accounting-side rendering of charge journal entries** — the purchase
  voucher is per-PR (`load-voucher.ts`, GL lines filtered to
  `source_table='purchase_requests'`) and the accounting register's per-PO
  subtotal (`groupRegisterByPo`) sums member gross only, so a posted charge
  entry appears on neither. Recorded seam, 🔔 flagged to the operator:
  until an accounting drill for `purchase_order_charges` entries exists, the
  register's PO subtotal ≠ PO grand total **by design** (the GL itself is
  complete and correct; only the accounting UI lags).

## Verification checklist

- pgTAP: enum + table shape + RLS (no write policies, read follows PO);
  `add` gate (site_admin refused, 4 create-roles allowed); `add` on unknown
  PO raises; CHECK amount > 0; `other` requires note; outbox job enqueued
  with `source_event='po_charge'`; GL entry legs for a mixed WP+store PO
  (allocation sums exactly, Dr/Cr balance, discount contra shape); drain
  routes a `purchase_order_charges` job to the new poster (and the else-arm
  regression: no other source_table broke); void charge: gate (plain
  procurement refused; each of PM / super_admin / **project_director**
  admitted), posted → entry reversed, pending → job skipped, row gone, audit
  rows both actions;
  `void_purchase_order` on a PO with charges reverses/skips charge entries
  and cascades rows (extends spec 259's pgTAP).
- TS unit: `purchaseOrderTotal()` with transport/other/discount mixes;
  discount never flips a total negative (floor at 0 with a rendered warning
  is NOT wanted — a negative PO total is a data-entry error the UI should
  show as-is; assert sign passes through).
- `pnpm lint && pnpm typecheck && pnpm test` + real-browser: add charges at
  create + from detail; totals everywhere agree; manager-only void hidden
  from plain procurement.
