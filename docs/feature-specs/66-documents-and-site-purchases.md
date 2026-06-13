# Spec 66 — Documents have a home; on-site purchases are recordable

**Status:** COMPLETE (2026-06-13) — migration applied to prod; lint/typecheck/
unit/build green + pgTAP 765/765. Acceptance = operator phone pass on both
flows. **ADR:** 0043 (model + decisions). **Type:** feature (prod DB migration).

## Why

Site staff (2026-06-13): (1) invoices/receipts that arrive with a delivery have
no obviously-named upload home; (2) on-site cash purchases (no request→approve)
can't be recorded, so the receipt + spend have nowhere to live. Operator calls:
record + PM-acknowledge; capture item + receipt; feature-first.

## What ships

### Schema (5 migrations; ALTER TYPE ADD VALUE each its own txn)

1. `purchase_request_attachment_purpose` += `'invoice'`.
2. `purchase_request_status` += `'site_purchased'` (after `delivered`).
3. amend `pr_source_valid` (+`'site_purchase'`); add
   `purchase_requests.acknowledged_at` / `acknowledged_by` (nullable, not
   granted).
4. DROP+CREATE the attachments INSERT policy + the `pr-attachments` storage
   upload policy, adding an **invoice arm** (parent status `purchased |
on_route | delivered | site_purchased`, requester role, `created_by =
auth.uid()`); `CREATE OR REPLACE` `pr_attachment_tombstone_target_ok` so
   `'invoice'` is creator-only removable. Preserve the recursion cure +
   `objects.name` qualification.
5. `record_site_purchase(p_work_package_id, p_item_description, p_quantity,
p_unit) returns uuid` and `acknowledge_site_purchase(p_id) returns void`
   (SECURITY DEFINER, `search_path=public`, role-gated; grants
   authenticated-only). See ADR 0043 §6–§7 for the guards (role + WP existence;
   one `action='insert'` audit row, no notification).

### App

- `src/lib/purchasing/validate-site-purchase.ts` — pure input validator
  (item/unit non-blank + length caps, qty > 0). Test-first.
- `src/app/requests/actions.ts` — `recordSitePurchase` (relays the RPC, returns
  id), `addInvoiceAttachment` (mirrors `addDeliveryConfirmationPhoto` but
  `purpose='invoice'`, admits the purchased/on_route/delivered/site_purchased
  parent states), `acknowledgeSitePurchase`.
- `src/lib/db/database.types.ts` — hand-extend enums + columns + RPC sigs
  (reconciled with `db:types` after the real push).
- `src/lib/status-colors.ts` + `src/lib/i18n/labels.ts` — `site_purchased`
  (PILL_EMERALD; label `ซื้อหน้างาน`). Typecheck forces both.

### UI (WP-centric)

- **WP detail purchasing zone** (`…/work-packages/[workPackageId]/page.tsx`):
  a named `บันทึกการซื้อหน้างาน` `<details>` (item + qty/unit form →
  `recordSitePurchase` → attach receipt as invoice). New `InvoiceUploader`
  (DeliveryPhotoUploader pattern, `purpose='invoice'`).
- **Request detail** (`/requests/[requestId]/page.tsx`): a named
  `เอกสาร (ใบส่งของ / ใบเสร็จ)` section — invoice attachments + an obvious
  attach control, visible when status `purchased|on_route|delivered|
site_purchased`. Site-purchase rows show the `ซื้อหน้างาน` + ack badge and,
  for PM/super, a `รับทราบ` button (`acknowledgeSitePurchase`, via
  `ConfirmDialog` — not `window.confirm`).
- New code follows doctrine: `ConfirmDialog`, `min-h-11`, `classes.ts`, Thai
  via `labels.ts`.

## Tests

- Unit: `validate-site-purchase` boundaries.
- pgTAP (new `…-site-purchase.test.sql`): the two RPCs (SECURITY DEFINER +
  search_path; role gates; happy path; input re-checks; WP-existence; exactly
  one `insert` audit row, zero delivery/purchase audit rows, zero
  notification_outbox rows; appsheet_writer cannot see the row; ack idempotent
  - scoped + cols not granted); invoice attachment RLS (lives on
    purchased/on_route/delivered/site_purchased, 42501 on requested; trigger
    non-interference — invoice on on_route leaves status unchanged, no
    delivered_at; append-only P0001; creator-only tombstone). Update
    `enum_has_labels` pins (status → 8, purpose → 3) + plan counts.

## Verification

`pnpm lint && pnpm typecheck && pnpm test` + `pnpm build` green (hand-extended
types). **Gate → operator confirm →** `db:push` → `db:types` → reconcile →
`db:test`. Acceptance = operator phone pass on both flows.

## Seams (recorded, not in this unit)

PDF invoices; push-notify PM on site purchase; a PM "awaiting acknowledgement"
queue; capturing amount/supplier on site purchases.
