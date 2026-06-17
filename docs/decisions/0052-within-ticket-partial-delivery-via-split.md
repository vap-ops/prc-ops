# ADR 0052 — Within-ticket partial delivery via split-on-receipt

- Status: Accepted (2026-06-17). Operator accepted; amount split = proportional
  default, buyer-editable (decision 4).
- Amends: ADR 0044 §7 (which deferred "partial receipt _within_ a single ticket —
  split quantity → a receipts/`quantity_received` unit"). This ADR decides that
  unit's mechanic. Implemented by spec 134 Unit 3.
- Context: a `purchase_request` is one item line / one quantity, delivered
  atomically (status → `delivered`). Partial delivery _across_ tickets already
  works (each ticket delivers independently) and spec 134 U1/U2 now surface it as a
  PO roll-up (`derivePurchaseOrderStatus` → `partially_received`). What remains is
  partial delivery _within_ one ticket: ordered 100, 50 arrives now, 50 later. The
  operator confirmed (2026-06-17) this is ~1–2% of cases (the other ~98% are
  across-ticket). The decision below is sized to that frequency.

## Decisions

1. **Split, not a `quantity_received` receipts ledger.** When a ticket's quantity
   arrives in parts, **split it into a delivered portion + a remaining portion**,
   both members of the same PO. The across-ticket roll-up
   (`derivePurchaseOrderStatus`) and spec 134 U1/U2 already render
   `partially_received` from ordinary member statuses, so a split produces two
   ordinary tickets and needs **zero** new derive/display logic. A cumulative
   ledger (new table + RLS + cumulative-vs-ordered derivation + partial-qty display
   on every purchasing surface) is rejected as over-build for a 1–2% path.

2. **Lineage column.** Add `purchase_requests.split_from_request_id uuid null
references purchase_requests(id)`. A line's original ordered quantity =
   the sum over its split family; the split audit row also records it. Indexed for
   the family read.

3. **Identity: the original row becomes the delivered portion; a new child carries
   the remainder.** The original row's `quantity` is reduced to the received amount
   and it goes `delivered` (`delivered_at` / `received_by` / `delivery_note` set,
   mirroring the normal delivery path). A **new child** row carries the remainder:
   `quantity = ordered − received`, `status = 'on_route'`, same `purchase_order_id`,
   `work_package_id`, `supplier`/`supplier_id`, `item_description`, `unit`,
   `priority`, `eta`, `needed_by`; new `pr_number`; `split_from_request_id =
original.id`. The child can itself be split again (the chain handles repeated
   partials). Reducing the original's `quantity` is not lossy — the audit row +
   the split family reconstruct the original ask.

4. **Amount split: proportional by quantity (default), buyer-editable** (operator
   decision 2026-06-17). The RPC takes an optional `p_delivered_amount`: omitted →
   `delivered.amount = round(original.amount × received / ordered, 2)`; supplied →
   `delivered.amount = p_delivered_amount` (guarded `0 ≤ p_delivered_amount ≤
original.amount`). Either way `remaining.amount = original.amount −
delivered.amount`, so the family sum is **exactly** the original (no drift) and
   per-WP material spend (specs 100/103/106, which read `amount` per ticket) is
   unchanged. If `original.amount` is null (unpriced), both rows stay null. VAT
   (ADR 0045): `amount` is gross; the split keeps gross consistent, net/VAT re-derive
   per row. **UI:** the "รับบางส่วน" form prefills the proportional delivered amount
   and lets the buyer override it (for an invoice that splits non-proportionally).

5. **Mechanic: one guarded `SECURITY DEFINER` RPC**
   `split_purchase_request_on_receipt(p_request_id uuid, p_received_qty numeric,
p_received_by text, p_delivery_note text)`. Runs on the **authenticated session**
   (spec-68 / ADR 0044 §4: a role-gated DEFINER RPC needs a non-null `auth.uid()`);
   back-office gate via `current_user_role()`; `grant execute to authenticated`; no
   direct table write policy for the new column (ADR 0038 fact-column posture — the
   column-scoped authenticated grant does not name `split_from_request_id`, so only
   the RPC writes it). Guards: the target is an in-transit member (`status in
('purchased','on_route')`) with `purchase_order_id` set, and
   `0 < p_received_qty < quantity` (equal-or-greater is a **full** delivery →
   reject, use the existing photo/delivery path). All-or-nothing in one transaction;
   one audit row records the split (original id, child id, received + remaining qty,
   original ordered qty, the split amounts).

6. **Confirmation photo on the partial is OPTIONAL.** The RPC marks the delivered
   portion `delivered` from `received_by` / `delivery_note`; a confirmation photo
   (ADR 0028/0030, the spec-24 photo-completes-delivery trigger keys on
   `purpose='delivery_confirmation'`) may be attached after, like any delivered
   ticket, but is **not required** to complete the split. The PO-level
   proof-of-delivery attachment (spec 134 U4a) carries documentary evidence.
   _Recorded seam: if photo-mandatory partials are wanted, gate the RPC on an
   existing confirmation attachment._

7. **UI:** a **"รับบางส่วน"** action on each in-transit line of the PO detail
   (spec 134 U1) — quantity received (+ optional note). After the split the detail
   re-renders (delivered child + remaining child) and the PO badge becomes
   `partially_received` for free via the roll-up.

8. **Out of scope (recorded seams):** editing / undoing a split (a wrong split is
   corrected by a follow-up — a reverse RPC or the supersede/cancel pattern is a
   later unit); the rejected `quantity_received` ledger (decision 1). Lalamove
   auto-POD (spec 134 U4b) is orthogonal — it fans into `delivered` + proof
   attachments, not the within-ticket split.

## Why not the alternatives

- **Cumulative `quantity_received` ledger** (the ADR 0044 §7 wording): a new table +
  RLS + cumulative derivation + partial-qty display on every surface — heavy
  infrastructure that fires 1–2% of the time. Rejected (decision 1).
- **Original stays as the "as-ordered" record, two children created.** Cleaner audit
  (the original is never mutated) but costs an extra row and a status the
  `purchase_request_status` enum doesn't model (an "ordered-but-superseded" parent).
  The lineage column + audit row already make the original reconstructable, so the
  extra row isn't worth it. Rejected (decision 3).
- **Full amount on the delivered portion, remainder 0.** Understates the outstanding
  commitment and distorts per-WP spend mid-delivery. Rejected (decision 4).

## Consequences

One new nullable FK column + one SECURITY DEFINER RPC + the "รับบางส่วน" UI on the PO
detail. The PO roll-up and spec 134 U1/U2 need **no** change (the split yields
ordinary member tickets). Per-WP material spend is preserved by the family-sum
invariant (decision 4). The migration ships under the change-management gate
(migration + reviewed PR + operator `db:push`); pgTAP proves the RPC: role gate
(back office only; `appsheet_writer` / unauthenticated refused), quantity guards
(0 / equal / over → reject), correct delivered + remaining quantities,
`split_from_request_id` set, both rows share the PO, amount reconciliation exact,
one audit row, all-or-nothing rollback on a bad line.
