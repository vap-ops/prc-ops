# Spec 103 — Capture the on-site purchase amount

**Status:** COMPLETE (2026-06-15; **SCHEMA** — one RPC migration, operator-gated db:push;
acceptance = operator phone).
**Driver:** make the dashboard's material spend real. Map-then-spec found `record_purchase` ALREADY
captures amount end-to-end (form + action + RPC coalesce); the only gap was **site purchases**.

## Why

`record_site_purchase` wrote `amount = NULL` (spec 66 didn't capture it), so on-site cash buys never
counted in the spec-100 dashboard material spend (`sumMaterials` sums `purchase_requests.amount` over
spend statuses incl. `site_purchased`). Capture the amount and they count.

## Scope (site-purchase path only)

`record_purchase` (the back-office record-a-purchase flow) is untouched — it already takes/writes
`p_amount`. This spec only adds amount to **record_site_purchase**.

## What ships

- **Migration `20260630000100_record_site_purchase_amount.sql`** — DROP+CREATE `record_site_purchase`
  with a new `p_amount numeric default null` (CREATE OR REPLACE can't add a param). Body = the current
  20260625000500 version (keeps `received_by_id`) + amount: positive-when-given check, `amount` in the
  INSERT, `amount` in the audit payload. Re-grants execute to authenticated (drop drops the grant).
  amount stays money — written ONLY by this SECURITY DEFINER RPC (authenticated has zero direct grant).
- **`validate-site-purchase.ts`** — `amount: number | null` (positive/finite when given).
- **`recordSitePurchase` action** — `amount` in the input; passes `p_amount` (omitted when null →
  RPC default).
- **`site-purchase-form.tsx`** — an optional `จำนวนเงิน (บาท, ไม่บังคับ)` number field.
- **`database.types.ts`** — hand-extended `record_site_purchase` Args with `p_amount?: number`
  (db:types regen reconciles byte-exact after push).

## Tests

- `validate-site-purchase.test.ts` — value now carries `amount`; +1 case (positive accepted,
  null accepted, ≤0/NaN rejected).
- pgTAP `33-site-purchase.test.sql` — signature pin → 5 args; +3 (plan 27→30): records with amount,
  asserts `amount` persisted, rejects amount ≤ 0. Existing 4-arg-style calls still pass (p_amount
  defaults).
- 767 unit / lint / typecheck / build green; db:push + db:test under the operator gate.

## Seams (recorded)

- Amount stays **optional** everywhere (record_purchase + site purchase) — dashboard material spend is
  still "counted where priced". Making it required is a separate workflow decision.
- record_purchase already complete (no change here).
