# Spec 259 — Void purchase order (procurement self-service revert)

**Status:** SHIPPED (2026-07-03) — RPC pgTAP 23/23 green; real incident PO-3245
(19 store-bound lines) reverted live via the RPC same session, verified
(all 19 → approved, PO row + its delivery gone, audit row recorded).
**Origin:** Operator — PO-3245 was created by mistake (duplicate/test order, still
in the `open`/`ordered` stage, nothing shipped). Today there is no way to undo it:
`purchase_orders` has no DELETE/UPDATE policy (ADR 0044 §6 — the creation RPC is
the only writer), and there is no revert RPC at all. The only "fix" would be an
operator hand-editing prod rows outside the app — exactly the kind of action
`change-management.md`/`break-glass.md` reserve for genuine emergencies, not a
routine "oops, wrong supplier picked" correction. The operator wants procurement
(and PM/super_admin — whoever can create a PO) to be able to self-serve this
correction through the app, the same way they self-serve creation.

**Amends ADR 0038** (in-app purchase/shipment write path) — adds a third
SECURITY DEFINER RPC to the existing `record_purchase`/`create_purchase_order`
family, same role gate, same "RPC is the only writer" posture. No new ADR: this
is the established pattern (role-gated DEFINER RPC, fact columns only) applied
symmetrically — whoever can create a PO can undo their own mistake before it
ships. Not a break-glass case (`purchase_orders`/`purchase_requests` are
ordinary mutable tables, not append-only) and not schema-destructive (no DROP,
no column removal) — a normal reviewed migration.

## Why "void", not "edit"

A wrongly-created PO is not a PO with wrong details to correct in place — the
operator confirmed PO-3245 specifically **should not exist**. So the fix is:

1. Un-bundle every member `purchase_request` back to exactly its pre-purchase
   state (`status = 'approved'`, every purchase-time fact nulled) — the tickets
   themselves are real and valid, they just need to be free to be bundled into
   the _correct_ PO.
2. Delete the mistaken `purchase_orders` row outright (its `po_number` is
   retired, never reused — same non-reuse convention as every other running
   sequence in this app).

Editing-in-place (keep the PO row, let procurement change supplier/lines) is
explicitly out of scope — ADR 0044 §7 already parked "editing a PO's line set
after creation" as a recorded seam, and the operator's ask here is revert, not
edit.

## Guard: only while nothing has shipped

A PO is revertible only while **every** member ticket is still sitting at
`status = 'purchased'` — i.e. the derived PO status (`purchase-order.ts`) is
`open` or `ordered`, nothing `on_route`/`delivered`. Once a single line has
shipped (`record_shipment`) or been received, voiding the whole order is no
longer a clean undo (a courier is physically moving goods, a delivery has
proof-of-receipt) — that case needs the existing per-ticket paths (rejection/
divert/return), not this RPC. `void_purchase_order` raises and does nothing if
any member has progressed past `purchased`.

## Money correctness — the part that's easy to get wrong

`create_purchase_order` flips each member to `status = 'purchased'` with a
non-null `amount`. The `purchase_requests_enqueue_gl_posting_upd`/`_ins`
triggers (20260741000100) fire on exactly that transition and enqueue a
`gl_posting_outbox` job (`source_event = 'purchase'`); the drain may have
already posted it as a real journal entry (Dr 1400 WIP + Dr 1300 input VAT /
Cr 2100 AP) for WP-bound lines.

Simply nulling `status`/`amount` back does **not** reverse that — the UPDATE
trigger's `WHEN` clause requires `new.amount is not null`, so setting `amount`
back to `null` does **not** re-enqueue anything either. Left alone, a posted
purchase entry would become a permanent phantom AP/WIP line for a PO that no
longer exists.

The fix is the same one `divert_purchase_to_store` (spec 198 U2,
`20260813001000`) already established for exactly this shape of problem — undo
a committed purchase before it can post twice or post-and-vanish:

1. **Reverse the posted entry directly**, per member, if one exists:
   `reverse_journal_internal` on any non-reversed `journal_entries` row with
   `source_table='purchase_requests', source_id=<member>, source_event='purchase'`.
2. **Skip any still-pending/posting job** for that same source so the drain can
   never post it after the fact:
   `update gl_posting_outbox set status='skipped' where … status in ('pending','posting')`.

Either the job hadn't drained yet (skip → nothing ever posts, clean) or it had
(reverse → net zero), and the two are mutually exclusive per member so this
never double-reverses.

## RPC

```
void_purchase_order(p_po_id uuid) returns void
```

- **Role gate:** `project_manager | procurement | super_admin` — identical to
  `create_purchase_order`'s gate (ADR 0044 §4). Symmetric: create and undo are
  the same audience. `procurement` is explicitly IN — this is the concrete
  capability the operator asked for (self-service, no admin/engineer needed).
- **404 guard:** unknown `p_po_id` raises (mirrors every other RPC in this
  family).
- **State guard:** any member not `status = 'purchased'` → raise, void nothing
  (all-or-nothing, no partial revert).
- **Per member:** reverse posted GL entry if any + skip pending/posting outbox
  job (money-correctness section above), then reset to the exact pre-purchase
  shape: `status='approved', purchase_order_id=null, delivery_id=null,
supplier=null, supplier_id=null, amount=null, vat_rate=0 (NOT NULL — spec 119's
"no VAT recorded" default), order_ref=null, eta=null, purchased_at=null`.
  (`needed_by` is the requester's own field, never
  touched — only the purchase-time facts `create_purchase_order` itself stamped
  are undone.)
- **Audit:** one `audit_log` row, action `purchase_order_void`, payload
  `{po_number, supplier, request_ids}` — captured before delete since the PO
  row and its FK are about to disappear. `purchase_requests`' own fact-audit
  trigger fires per-line for the approved-status flip (existing trigger,
  unchanged, same as creation's per-line rows).
- **Delete:** `delete from purchase_orders where id = p_po_id` —
  `purchase_order_deliveries` cascades (`on delete cascade`, spec 135 U1); a
  PO that never split into multiple deliveries has at most its one
  auto-created default delivery, cleaned up for free.

## UI

`/requests/orders/[poId]` gets a "ยกเลิกใบสั่งซื้อ" (void) action, visible only
when `canManage` (same `isBackOfficeRole` gate the delivery-management section
already uses) **and** every member is still `purchased` (mirrors the RPC guard
client-side so the button doesn't appear for an unreversible order). Confirm
dialog (destructive-style, names the PO number + line count) before calling
the server action — this is a one-way door for the PO itself (the tickets
survive, but the order and its number are gone), same weight as other
destructive confirms in the app.

## Out of scope

- Editing a PO in place (supplier/lines) — ADR 0044 §7 seam, unrelated ask.
- Voiding a partially-shipped/delivered order — the guard refuses it; those
  cases use the existing per-ticket reject/divert/return paths.
- A general "procurement gets admin powers" framework — this spec grants
  exactly one capability (undo your own not-yet-shipped PO) to exactly the
  role set that already creates POs. Any further admin-only action procurement
  needs is its own spec, decided on its own merits.

## Verification checklist

- pgTAP: role gate (site_admin refused, procurement/PM/super_admin allowed);
  unknown PO raises; a shipped/delivered member blocks the whole void; a clean
  all-`purchased` PO — members return to `approved` with every purchase fact
  null, PO row gone, `purchase_order_deliveries` gone (cascade); a posted GL
  entry gets reversed (net-zero journal check); a still-pending outbox job
  ends `skipped`, never posts after void; audit_log row shape.
- `pnpm lint && pnpm typecheck && pnpm test`.
- Real-browser: void button shows for procurement/PM/super_admin on an
  all-purchased PO, absent for site_admin and for a PO with a shipped line;
  confirm → PO gone from `/requests/orders`, member tickets back in the
  approved pool ready to be bundled into a new PO.
