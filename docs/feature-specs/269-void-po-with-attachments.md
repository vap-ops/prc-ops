# Spec 269 — Void a purchase order that has attachments (bug fix)

**Status:** Built — 2026-07-06; migration applied to prod, PR HELD for the
operator's merge.
**Amends:** spec 259 (`void_purchase_order`), spec 125 / ADR 0046 (PO
attachments append-only posture), ADR 0038 (purchase write-path family).
**Trigger:** live prod incident — PO-4073 cannot be voided; `void_purchase_order`
fails `P0001` for ANY purchase order that has a `purchase_order_attachments`
row. At discovery that is 22 of 27 POs (81%): voiding is effectively broken for
every real order, because `create_purchase_order`'s UI flow uploads the source
document for most orders.

## 1. Root cause

Two correct-in-isolation mechanisms contradict each other:

1. `void_purchase_order` (spec 259, re-created verbatim by the spec 261 parity
   sweep `20260813071000`) ends with
   `delete from public.purchase_orders where id = p_po_id`. Its comment names
   `purchase_order_deliveries` + `purchase_order_charges` as the cascading
   children; `purchase_order_attachments` (added earlier by spec 125,
   `20260703000000`) was overlooked.
2. `purchase_order_attachments.purchase_order_id` is
   `references purchase_orders(id) on delete cascade`, AND the table carries the
   append-only block-write trigger `purchase_order_attachments_block_write()`
   (`BEFORE UPDATE OR DELETE … FOR EACH ROW` + `BEFORE TRUNCATE … FOR EACH
STATEMENT`) which raises `P0001` on every operation. The FK asks for a
   DELETE the trigger forbids, so the cascade — and with it the whole void —
   aborts: `P0001: purchase_order_attachments is append-only: DELETE is not
allowed (supersede via INSERT instead)`.

Child-FK sweep of the PO delete graph (from LIVE, 2026-07-06) confirms
attachments is the ONLY blocking child: `purchase_order_deliveries` (CASCADE,
no block trigger), `purchase_order_charges` (CASCADE, GL-enqueue trigger only),
`purchase_requests` (NO ACTION — nulled by the RPC before the delete),
`purchase_order_attachments.delivery_id` → deliveries (NO ACTION — its rows die
in the same statement via the PO cascade, so the end-of-statement check holds).

**Secondary bug:** `voidPurchaseOrder` in `src/app/requests/actions.ts` maps
EVERY `P0001` to one Thai message ("มีรายการที่จัดส่งหรือรับของแล้ว
หรือไม่พบใบสั่งซื้อนี้") — misleading here, since the RPC also bubbles unrelated
P0001s (this trigger, `reverse_journal_internal`, …).

## 2. Decision

### D1 — the cascade may delete; direct writes stay blocked

`purchase_order_attachments_block_write()` gains exactly one carve-out: a
DELETE is allowed **iff the parent PO row is already gone** — i.e. the DELETE
is the `purchase_orders` ON DELETE CASCADE at work inside the same statement.
Everything else (UPDATE, TRUNCATE, and any direct DELETE while the parent
exists) still raises `P0001` unchanged.

```
if tg_op = 'DELETE'
   and not exists (select 1 from public.purchase_orders po
                    where po.id = old.purchase_order_id) then
  return old;
end if;
raise exception … using errcode = 'P0001';
```

Why parent-gone instead of the alternatives considered:

- **`pg_trigger_depth()` guard** — passes for ANY nested-trigger context, not
  just the RI cascade, so an unrelated future trigger doing DELETEs would slip
  through. Parent-gone is exactly the cascade's own semantics (FK integrity
  guarantees a live parent for every row outside a cascade), and it
  fails CLOSED: if the check can't see `purchase_orders` it blocks, never
  opens.
- **RPC pre-deletes attachments under a session flag** — needs bespoke bypass
  machinery (a settable flag is itself an attack surface for anyone holding
  DELETE privilege).
- **Refuse to void a PO that has attachments** — defeats the fix; 81% of real
  POs have one.

The trigger stays `NOT SECURITY DEFINER`. In the only path that reaches the
carve-out (the cascade inside the SECURITY DEFINER RPC) the check runs as the
function owner and sees the truth; a hypothetical direct DELETE by a role that
can't see the parent PO row is already stopped one layer earlier — the table
has **no DELETE grant** (append-only layer 1) — and the fail-closed shape means
RLS blindness can only over-block, never leak.

### D2 — history survives in the void audit row

The append-only INTENT (attachment history is never silently lost) moves to
the audit trail: `void_purchase_order` snapshots every attachment row of the
PO into the existing `purchase_order_void` audit payload **before** the
delete, as `payload.attachments` — an array of
`{id, kind, purpose, delivery_id, storage_path, superseded_by, created_by,
created_at}` (i.e. the full row minus nothing; `[]` when the PO has none).
`audit_log` is itself append-only (ADR 0004), so the record is durable.

### D3 — storage objects are intentionally orphaned

The files in the private `po-attachments` bucket are NOT deleted by the void.
Rationale: the bucket has no user-facing listing (reads go through the table →
service-role signed URLs, per spec 125), so orphans are invisible to users;
the audit payload retains every `storage_path` for recovery/forensics; and
keeping storage mutation out of the RPC avoids a whole class of partial-void
failure modes. Orphan cleanup, if ever needed, is a separate future janitor
task fed by exactly these audit payloads. Documented here as deliberate.

### D4 — distinct errcodes; honest Thai errors

`void_purchase_order`'s two refusal sites get distinct custom SQLSTATEs
(class `PO` is unused by Postgres; 5-char `[0-9A-Z]` is the SQLSTATE format):

| Site                              | Old     | New       |
| --------------------------------- | ------- | --------- |
| purchase order not found          | `P0001` | `PO404`   |
| order has a shipped/received line | `P0001` | `PO409`   |
| role gate                         | `42501` | unchanged |

`src/app/requests/actions.ts` `voidPurchaseOrder` maps through a new pure
helper `voidPurchaseOrderErrorMessage(code)` in
`src/lib/purchasing/purchase-order.ts` (beside `canVoidPurchaseOrder`, the
existing client mirror — which needs NO change; attachments never gated void):

- `42501` → "ไม่มีสิทธิ์ยกเลิกใบสั่งซื้อ" (unchanged)
- `PO404` → "ไม่พบใบสั่งซื้อนี้ อาจถูกยกเลิกไปแล้ว"
- `PO409` → "ยกเลิกไม่ได้: มีรายการที่จัดส่งหรือรับของแล้ว"
- anything else (incl. any remaining `P0001`) → the generic
  "ยกเลิกใบสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" — never the old misleading
  blanket text.

## 3. Change inventory (one unit)

1. **Migration `20260813072100_spec269_void_po_attachments.sql`** — CREATE OR
   REPLACE only (no signature change → grants preserved, no `db:types` drift,
   no anon-regrant trap):
   - `purchase_order_attachments_block_write()` — D1 carve-out.
   - `void_purchase_order(uuid)` — body re-sourced VERBATIM from LIVE
     (`pg_get_functiondef`, 2026-07-06 — includes the spec 261 manager-only
     gate and the spec 260 charge-reversal loop), with exactly three edits:
     D2 payload, D4 errcodes, updated header comment.
2. **pgTAP `supabase/tests/database/259-void-purchase-order.test.sql`** —
   the two `throws_ok` errcode pins move `P0001` → `PO404`/`PO409`; new
   section K: a PO with attachment rows (content + proof_of_delivery bound to
   its default delivery + a superseded pair) voids clean — rows gone, audit
   payload names them all — and direct DELETE/UPDATE on a surviving PO's
   attachment still raise `P0001`.
3. **`src/lib/purchasing/purchase-order.ts`** — `voidPurchaseOrderErrorMessage`
   (pure), unit-tested in `tests/unit/purchase-order.test.ts` (failing test
   first); `src/app/requests/actions.ts` `voidPurchaseOrder` switches to it.

## 4. Verification checklist

- [x] Preflight (rolled-back multi-statement `db query` on prod): fixture PO +
      attachment → `void_purchase_order` raises `P0001` WITHOUT the new defs
      (bug reproduced), succeeds WITH them applied in-transaction; direct
      DELETE with parent alive still raises `P0001`. Nothing persists.
- [x] `pnpm db:test` after `db:push`: 259 = 36/36 incl. section K; spec-261's
      two void errcode pins updated in the same unit (grep-all-pins). The only
      remaining full-suite reds pre-date this change (200-store GL data-drift,
      221-catalog user-data flake, 100-anon-exec = spec-268 signature widen,
      fixed by its own PR).
- [x] `pnpm lint && pnpm typecheck && pnpm test` green (vitest 2820).
- [ ] PR through the gate — danger-path guard HOLDS it (migrations path);
      operator merges. NO PAT self-merge (append-only posture change = the
      operator's call).

## 5. Out of scope (deliberate)

- Purging the orphaned storage objects (D3 janitor) — future unit if wanted.
- The same blanket-`P0001` mapping pattern in OTHER actions
  (`addPurchaseOrderCharge`, …) — separate cleanup spec if wanted.
- Any attachments UI change; any void-eligibility change (`canVoidPurchaseOrder`
  logic untouched).
- Retiring the misleading message elsewhere it may appear verbatim.
