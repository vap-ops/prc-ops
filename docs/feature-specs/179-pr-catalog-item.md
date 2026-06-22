# Spec 179 — Purchase request links a catalog item

Status: SHIPPED to prod — 2026-06-22 (U1 DB + write path, U2 form picker).
Builds on: spec 171 (procurement raises PRs from the WP screen), spec 175 (item
catalog / `catalog_items` master).

## Problem

Procurement can now raise a purchase request from the WP screen (spec 171), but
the requisition item is a **free-text box** (`รายการวัสดุ`) — the requester
re-types the item name every time, exactly the per-site spelling drift the item
catalog (spec 175) exists to kill. Items are not selectable from the catalog.

Operator, 2026-06-22: "Procurement can make PR, but the items are not selectable
yet." — fix this first.

## Decision (operator, 2026-06-22)

**Real FK link**, not a UI snapshot. A purchase request gains a nullable
`catalog_item_id` FK to `catalog_items`. Picking a catalog item sets the link
**and** prefills the existing `item_description` + `unit` text (a human-readable
snapshot that survives even if the catalog row is later edited/deactivated). The
free-text path stays for off-catalog items (`นอกแคตตาล็อก`): `catalog_item_id`
null, requester types the description + unit as today.

Why the link (not snapshot-only): it lets a later unit reconcile
PR → stock-in → on-hand against one item identity, and measure spend-by-item per
catalog row. The snapshot alone could not.

## Units

### U1 — `catalog_item_id` on `purchase_requests` (DB + write path)

- Migration: `alter table purchase_requests add column catalog_item_id uuid
references catalog_items(id)` — **nullable** (off-catalog requests carry null).
- `purchase_requests` INSERT is **column-scoped** to `authenticated`
  (migration 20260616000400). A new column is NOT covered by the existing grant,
  so add `grant insert (catalog_item_id) on purchase_requests to authenticated`.
  SELECT is table-level (unchanged) — the new column is readable without a grant.
- `validateCreatePurchaseRequest` accepts an optional `catalogItemId`
  (uuid-or-null); invalid uuid → reject; omitted/null/'' → null.
- `createPurchaseRequest` writes `catalog_item_id`.
- No RLS change: the INSERT policy pins `requested_by`/`source`/role only; the FK
  column is unconstrained and nullable.

### U2 — catalog picker on the PR form (UI)

- The form gains an optional `catalogItems` prop (omitted/empty → picker hidden,
  free-text only = today's behaviour, so the existing form tests are unaffected).
- A `<select>` grouped by `item_category` (mirrors the supply-plan picker):
  option label `baseItem · specAttrs (unit)`, value = catalog item id, plus a
  `นอกแคตตาล็อก (พิมพ์เอง)` option (value "").
- Picking a catalog item sets `catalogItemId` and prefills `item_description`
  (`baseItem` + ` specAttrs`) + `unit`. Choosing `นอกแคตตาล็อก` clears the link
  and lets the requester free-type. The `item_description`/`unit` fields stay
  visible/editable in both modes (the requester can refine brand/model).
- Both pages that render the form feed the project-agnostic active catalog:
  `projects/[id]/work-packages/[wpId]` (procurement + SA) and
  `review/work-packages/[wpId]` (PM review).

## Verification

- `validate-purchase-request.test.ts`: catalogItemId accepted (uuid), echoed;
  null/omitted → null; bad uuid → reject. Existing exact-shape `toEqual` updated
  to include `catalogItemId: null`.
- `purchase-request-form-catalog.test.tsx`: picker renders the grouped options
  when `catalogItems` supplied; selecting one prefills `รายการวัสดุ` + `หน่วย`.
- pgTAP `188-pr-catalog-item`: column exists, type uuid, nullable, FK to
  catalog_items; `authenticated` has INSERT on the column; a session insert can
  link a catalog item.
- `pnpm lint && pnpm typecheck && pnpm test`, then `pnpm db:push && pnpm db:types
&& pnpm db:test`, then `pnpm build`.

## Out of scope (follow-ups)

- Reconciling PR → stock-in → on-hand by `catalog_item_id` (the payoff the link
  enables) — a later store unit.
- Spend-by-item analytics per catalog row.
- Back-filling `catalog_item_id` on historical free-text requests.
- A typeahead/search picker (the grouped `<select>` matches supply-plan; a search
  box is a later UX unit if the catalog grows large).
