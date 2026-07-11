# Spec 300 — SA delivery receive: today-lens + one unified รับของ card

- Status: Draft (2026-07-12). Operator (brainstorm): "SA is overwhelmed with deliveries" —
  wants incoming deliveries filterable (**today / on-route / all**), **accepting them goes
  directly to the store**, and the paper receipt (**ใบส่งของ / ใบเสร็จ**) captured as an image
  when it arrives at the site. Extends the locked SA action-state lens
  ([[worklist-priority-alignment]]) and the store-first doctrine
  ([[store-first-material-flow-doctrine]], ADR 0065).

## Problem

The SA receive workflow is scattered across three disconnected surfaces:

1. **No "due today" lens on incoming.** The site `/requests` worklist groups by band (spec
   137); the `กำลังจัดส่ง` band is everything incoming (`purchased` + `on_route`), but there is
   no way to focus on what is **due or overdue** — spec 137 explicitly left "overdue filters
   for site" as a seam. An overwhelmed SA cannot see "what should be here by now."
2. **Accepting to the store re-types the delivery.** Goods enter the store via the manual
   multi-line `รับเข้า` grid (spec 198 `recordStockInBulk`), decoupled from the purchase
   request. The PR already knows its items and quantities, yet SA re-enters them. Delivered
   store-bound PRs with no `stock_receipt` yet are the "pending store receipt" backlog.
3. **The paper receipt is out of the receive moment.** The `ใบส่งของ / ใบเสร็จ` photo slot
   exists (`purpose='invoice'`, status-gated so SA already sees it) but lives in a separate
   section far below the `การรับของ` receive card on the PR page — and it was silently failing
   to upload for store-bound (WP-less) PRs until #456 fixed the storage RLS policy.

## Change

A small epic. **U1 is pure code-only.** U2 reuses existing components. U3 is conditional and
the only possible schema touch.

### U1 — Delivery "today" lens (code-only, no schema)

A delivery quick-filter over the `กำลังจัดส่ง` (incoming) band on the SA `/requests` worklist:

- **วันนี้** (default) = incoming **∧** (`eta ≤ today` **OR** `eta is null`) — due-or-overdue
  plus unknown-ETA. This is the SA's real pile: "should be here by now / arriving today /
  arrival unknown." Fills the spec-137 overdue seam.
- **กำลังมา** = status `on_route` (physically shipped, en route to site).
- **ทั้งหมด** = the whole `กำลังจัดส่ง` band (`purchased` + `on_route`).

Default **วันนี้**. A pure helper next to `request-bands.ts` (`groupRequestsByBand` already
takes `todayIso` and computes `overdue`), unit-tested TDD-first. No new query — the page
already fetches pending + decided rows. Procurement view unchanged.

- Placement (plan decides, does not change the pure helper): either a scoped chip row on the
  `กำลังจัดส่ง` band, or a `รับของวันนี้` entry from the `/sa` home that deep-links
  `/requests` pre-scoped to this lens. Driven by a query param (e.g. `?incoming=today|onroute|all`).

### U2 — One unified รับของ card (code-only)

On a `delivered` / `on_route` PR, merge the two separate cards (`การรับของ` delivery photo +
`เอกสาร (ใบส่งของ / ใบเสร็จ)`) into **one รับของ card** at the top of the receive view:

- **รับเข้าคลัง (accept → store)** — one confirm, **seeded from the PR's own lines** (items +
  quantities), recording the `stock_receipt` and clearing the pending-store-receipt backlog.
  No manual grid re-entry.
- **รูปรับของ** — the delivery-confirmation photo (existing `DeliveryPhotoUploader`; the photo
  completes delivery via the spec-24 trigger).
- **รูปใบส่งของ / ใบเสร็จ** — the receipt-paper photo (existing `InvoiceUploader`,
  `purpose='invoice'`), now **at the receive moment** instead of buried below.

Both uploaders already exist and now succeed for SA on store-bound PRs (post-#456). Photos are
optional-but-prompted; accept-to-store and each photo are independent actions on the one card.

### U3 — One-confirm PR→store receipt (CONDITIONAL; only unit that might touch schema)

Only if Gate-1 dependency-check finds no existing path that creates a `stock_receipt` from a
PR's lines: add a small server action `receivePurchaseRequestToStore(requestId)` that reads
the PR's lines under caller RLS and records the `stock_receipt`(s), mirroring `recordStockInBulk`
but seeded from the PR. **Additive only.** If it needs an RPC it serializes behind lane 298's
schema hold (`mig 075730`). If `recordStockInBulk` can be fed PR lines from the client, U3
collapses into U2 (pure code, no schema).

## Out of scope / seams

- **Site-destination deliveries.** Store-first stays (ADR 0065): goods still belong to the
  store; only the **paper** is captured at site (operator confirmed "paper", not a
  destination change). A goods-used-at-site path is a separate future spec.
- Per-line quantity edits at accept — v1 seeds the full PR quantity; corrections stay in the
  spec-198 `รับเข้า` grid / the reverse-receipt path.
- Partial / split-delivery line reconciliation. Keyset paging of the lens. Procurement view.

## Verification

- **U1:** unit tests for the lens (due-or-overdue, null-ETA included, `on_route` subset, all),
  green. App-only → no `db:push`.
- **U2 / U3:** real-flow in a browser as an SA (dev-preview login, memory `dev-preview-login`):
  filter **วันนี้** → open a store-bound delivered PR → **รับเข้าคลัง** (seeded, one confirm) →
  a `stock_receipt` is created and the pending-receipt backlog count drops → delivery photo →
  receipt photo; zero console errors. If U3 adds an RPC: a pgTAP test for its RLS + green
  `db:test` (zero collateral beyond the pinned known-reds).

## References

Spec 137 (site worklist bands — the `กำลังจัดส่ง` band + `todayIso`/overdue seam this fills) ·
spec 198 (multiline `รับเข้า` stock-in — the manual grid this seeds from the PR) · spec 208 /
ADR 0065 (store-first: all arrivals route through the store) · spec 285 (site-purchase → expense) ·
#456 (delivery-photo storage-RLS fix that unblocked SA uploads to `pr-attachments`).
