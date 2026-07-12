# Spec 312 — Void an equipment-rental batch

## Why

Procurement records equipment rentals at `/equipment/rentals`. Creating a batch
auto-posts a balanced GL entry (`Dr rental expense / Cr payable → supplier`, via
`post_rental_batch_to_gl`). There is **no** way to undo an erroneous or test
rental: no button, no RPC. POs have `void_purchase_order`; rental _charges_ have
`void_rental_charge`; a rental _batch_ has nothing. The `equipment_rental_batch`
`status` enum even carries a `cancelled` value that nothing writes and the list
view never reads — scaffolding that was never wired.

Operationally this has bitten twice (procurement test-rentals on prod, 2026-07-08
and 2026-07-12), each needing hand-run SQL to reverse the GL and delete the row.
This spec makes the void a first-class, gated, audited app operation so
procurement self-serves it — the same audience that can create a rental can undo
its own mistake.

## Scope

Void an **active** rental batch: reverse its GL, mark it `cancelled`, hide it
from the list. Refuse anything with downstream money (a settlement, or live
charges) — those have their own reversal paths (`supersede_rental_settlement`,
`void_rental_charge`) and must be unwound first. Allocations are kept as harmless
history (a cancelled batch is hidden regardless).

A batch can post up to **two** GL legs — the rent leg
(`source_table='equipment_rental_batches'`) and, when a deposit was paid, a
deposit leg the enqueue trigger books under the synthetic
`source_table='rental_deposits'` (`source_id` = the batch id). Void reverses
**both**.

Out of scope: voiding a settled/returned batch.

## U1 — `void_equipment_rental_batch` RPC (schema, money)

`void_equipment_rental_batch(p_batch_id uuid, p_reason text default null)
returns void`, `SECURITY DEFINER`, mirroring `void_purchase_order`:

1. **Gate** — `current_user_role()` in
   `('project_manager','super_admin','procurement','procurement_manager','project_director')`
   (the `create_equipment_rental_batch` set — incl. plain `procurement`), else `42501`.
2. **Exists** — batch row found, else `RB404`.
3. **State** — `status = 'active'`, else `RB409` (a settled/returned/cancelled
   batch is not void-able here).
4. **No downstream money** — no `rental_settlements` for the batch and no
   `rental_charges` rows, else `RB409`.
5. **Reverse GL** — for every posted `journal_entries` with
   `source_table in ('equipment_rental_batches','rental_deposits') and source_id=p_batch_id`
   not already reversed, `reverse_journal_internal(entry, auth.uid(), 'void: rental batch cancelled')`;
   set any `pending`/`posting` `gl_posting_outbox` job for the batch (both source
   tables) to `skipped`.
6. **Cancel** — `update equipment_rental_batches set status='cancelled'`.
7. **Audit** — `audit_log` action `equipment_batch_void`, payload `{supplier_id,
monthly_rate, reason}`.

Migrations: `075780` adds the `equipment_batch_void` audit-action enum value (own
migration — Postgres forbids using a new enum value in the txn that adds it);
`075781` defines the function, `revoke all … from public, anon; grant execute … to authenticated`.

pgTAP `312-equipment-batch-void`: non-back-office → 42501; unknown id → RB404;
non-active → RB409; batch with a charge → RB409; happy path → original entry
gains a reversal, net per account is zero, `status='cancelled'`, one
`equipment_batch_void` audit row.

## U2 — view filter + action + button (code)

- **View** — `RentalBatchRow` gains `status`; `buildRentalView` drops
  `status <> 'active'` batches so a cancelled card disappears. The page loader
  selects `status`.
- **Action** — `voidRentalBatch({ batchId, reason })` in
  `src/app/equipment/rentals/actions.ts`: `requireRole(BACK_OFFICE_ROLES)`,
  UUID-validate, call the RPC, map `42501`→no-permission, `RB404/RB409`→a
  specific Thai message, `revalidatePath`.
- **UI** — a `ยกเลิก` control on each rental card opening a small confirm with a
  required reason, wired to the action. Optimistic-free; re-reads on success.

vitest: `buildRentalView` hides cancelled; the action maps each errcode; the card
renders + confirms the void.

## Verification

pgTAP green; `pnpm lint/typecheck/test` green; browser: as procurement, void a
throwaway active batch → card disappears, ledger nets to zero, one audit row.
Danger-path (money + migration) → PR **held for operator merge**.
