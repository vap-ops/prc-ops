# Spec 300 — SA delivery receive: today-lens + one unified รับของ card

- Status: Draft (2026-07-12). Operator (brainstorm): "SA is overwhelmed with deliveries" —
  wants incoming deliveries filterable (**today / on-route / all**), confidence that
  **accepting a delivery lands it in the store**, and the paper receipt (**ใบส่งของ / ใบเสร็จ**)
  captured as an image when it arrives at the site. Extends the locked SA action-state lens
  ([[worklist-priority-alignment]]) and the store-first doctrine
  ([[store-first-material-flow-doctrine]], ADR 0065).
- **Code-only, no schema.** Gate-1 dependency check confirmed the accept-to-store mechanism
  already exists (see Problem 2); this spec only reorganises and filters existing surfaces.

## Problem

The SA receive workflow is scattered, and its automation is invisible:

1. **No "due today" lens on incoming.** The site `/requests` worklist groups by band (spec
   137); the `กำลังจัดส่ง` band is everything incoming (`purchased` + `on_route`), but there is
   no way to focus on what is **due or overdue** — spec 137 explicitly left "overdue filters
   for site" as a seam. An overwhelmed SA cannot see "what should be here by now."
2. **Accept-to-store already works, but is invisible.** A trigger
   (`purchase_requests_stock_in_on_receive`, spec 195 P3 / ADR 0063) fires on _every_ WP-less
   PR reaching `delivered` and auto-books the `stock_receipt` (goods into store, Dr Inventory
   1500 / Cr AP). The delivery-confirmation photo is what flips `on_route → delivered` (spec
   24). So **the delivery photo already IS the accept-to-store** — proven live: 205 of 206
   WP-less delivered PRs carry their auto-receipt (backlog: 1 legacy straggler). But the
   receive UI never tells the SA this landed in the store, so an overwhelmed SA has no
   confirmation and may distrust it or hunt for a manual step that does not exist.
3. **The paper receipt is out of the receive moment.** The `ใบส่งของ / ใบเสร็จ` photo slot
   exists (`purpose='invoice'`, status-gated so SA already sees it) but lives in a separate
   section far below the `การรับของ` receive card on the PR page — and it was silently failing
   to upload for store-bound (WP-less) PRs until #456 fixed the storage RLS policy.

## Change

Four code-only units (U3/U4 added after operator feedback on placement). No new server action, no RPC, no
migration — the accept-to-store trigger already exists (Problem 2); this only surfaces and
filters it.

### U1 — Delivery "today" lens (code-only, no schema)

A delivery quick-filter over the `กำลังจัดส่ง` (incoming) band on the SA `/requests` worklist:

- **วันนี้** (default) = incoming **∧** (`eta ≤ today` **OR** `eta is null`) — due-or-overdue
  plus unknown-ETA. This is the SA's real pile: "should be here by now / arriving today /
  arrival unknown." Fills the spec-137 overdue seam.
- **กำลังมา** = status `on_route` (physically shipped, en route to site).
- **ทั้งหมด** = the whole `กำลังจัดส่ง` band (`purchased` + `on_route`).

Default **วันนี้**. A pure helper next to `request-bands.ts` (`groupRequestsByBand` already
takes `todayIso`), unit-tested TDD-first. No new query — the page already fetches pending +
decided rows. Procurement view unchanged. Placement (plan decides, does not change the pure
helper): a scoped chip row on the `กำลังจัดส่ง` band, driven by a query param
(e.g. `?incoming=today|onroute|all`), `ของฉัน`/`view` preserved as orthogonal.

### U2 — One unified รับของ card (code-only)

On a `delivered` / `on_route` PR, merge the two separate cards (`การรับของ` delivery photo +
`เอกสาร (ใบส่งของ / ใบเสร็จ)`) into **one รับของ card** at the top of the receive view:

- **รูปรับของ** — the delivery-confirmation photo (existing `DeliveryPhotoUploader`). Taking it
  completes delivery **and** auto-books the store receipt (Problem 2). Unchanged mechanism.
- **รับเข้าคลังแล้ว confirmation** — once the PR is `delivered` and store-bound (its
  `stock_receipt` exists), show an explicit "✓ รับเข้าคลังแล้ว" line so the SA sees the goods
  landed in the store. A read-only indicator; no new write. (Derive from the delivered +
  WP-less state / the receipt's presence — the plan picks the exact source.)
- **รูปใบส่งของ / ใบเสร็จ** — the receipt-paper photo (existing `InvoiceUploader`,
  `purpose='invoice'`), moved **into this card** at the receive moment instead of a separate
  section further down.

Both uploaders already exist and now succeed for SA on store-bound PRs (post-#456). Photos are
optional-but-prompted.

### U3 — "ของเข้า" incoming section on the store page (code-only, added 2026-07-12)

Operator feedback after U1/U2 shipped: the SA looks for deliveries in the **คลัง & ของเข้า**
tile (the store page `/projects/[projectId]/store`), not the **คำขอซื้อ** (`/requests`) tab
where U1's lens + U2's card landed. So the incoming pipeline was invisible where the SA
actually receives. U3 surfaces it there:

- A new **ของเข้า** section at the top of the store page listing the project's incoming
  store-bound deliveries (`purchase_requests` with `status IN (purchased, on_route)` and
  `work_package_id IS NULL` — once `delivered`, the spec-195-P3 trigger auto-books them into
  the store, so they drop off). Read under the viewer's RLS (the store page already admits
  site_admin via `can_see_project`).
- Filtered by the **same** U1 lens (`วันนี้` default / `กำลังมา` / `ทั้งหมด`, via `?incoming=`),
  ordered due-first, with an `เลยกำหนด` flag. Each row links to `/requests/[id]` — the U2
  receive card, where the delivery photo completes the (auto) store receipt.
- Pure `selectStoreIncoming` (`src/lib/store/incoming.ts`, TDD) + server component
  `StoreIncomingList`; no new write, no schema, no RPC.

### U4 — Split ของเข้า off the store page into its own surface (code-only, 2026-07-12)

Operator, on seeing U3: **"deliveries today should not be on the same page as items in
store."** Correct — a time-sensitive receiving queue (ของเข้า) and static inventory (คลัง:
on-hand / รับเข้า / ตรวจนับ / P&L) are two different intents and shouldn't share a page. U4
separates them:

- **Revert** the ของเข้า section OFF `/projects/[projectId]/store` — the store page is
  inventory only again.
- **New dedicated route** `/projects/[projectId]/incoming` (`incomingHref`) rendering the same
  `StoreIncomingList` + lens + query. One intent per page.
- **Split the SA tile** "คลัง & ของเข้า" (`sa-tools.tsx`) into two: **ของเข้า** (→ the new route,
  receiving-first) and **คลัง** (→ the store page). The selector + list component from U3 are
  reused verbatim — only their host route changes.

Supersedes U3's placement (the code is reused, the surface moves). Lesson: pin the user's
actual navigation surface — U1/U2 built on the right data but the wrong _tab_ (คำขอซื้อ vs the
SA's receiving tile), and U3 then over-corrected onto the inventory page.

## Out of scope / seams

- **No receive action / RPC.** Accept-to-store is the existing spec-195-P3 trigger; building a
  manual "receive PR to store" would duplicate it. The lone legacy backlog straggler (1 PR
  delivered before the trigger) stays a manual spec-198 `รับเข้า`-grid case — not worth a
  feature.
- **Photo-always** (operator decision): the delivery photo is the only accept — no photo-less
  one-tap "received" (keeps the photo proof, the SA adoption bet, memory
  `sa-real-usage-photos-2026-07`).
- **Store-first stays** (ADR 0065): goods belong to the store; only the _paper_ is captured at
  site. Site-destination deliveries, per-line qty edits, split-delivery reconciliation,
  keyset paging of the lens, and the procurement view are all out of scope.

## Verification

- **U1:** unit tests for the lens (due-or-overdue, null-ETA included, `on_route` subset, all),
  green. App-only → no `db:push`.
- **U2:** real-flow in a browser as an SA (dev-preview login, memory `dev-preview-login`):
  filter **วันนี้** → open a store-bound `on_route` PR → take the delivery photo → card flips to
  **✓ รับเข้าคลังแล้ว** (the auto-receipt) → add the `ใบส่งของ/ใบเสร็จ` receipt photo in the same
  card; zero console errors. Confirm against the live DB that the `stock_receipt` exists for
  that PR (the trigger fired).
- **U3:** unit tests for `selectStoreIncoming` (lens filter, due-first sort, overdue flag,
  `item_description` fallback). Live-DB check that the incoming query returns the project's
  `purchased`/`on_route` WP-less PRs. App-only → no `db:push`; live store-page render is an
  operator-device eyeball (auth-gated project route, spec-137 standard).

## References

Spec 137 (site worklist bands — the `กำลังจัดส่ง` band + `todayIso`/overdue seam this fills) ·
spec 195 P3 / ADR 0063 (`purchase_requests_stock_in_on_receive` — the auto-receipt this makes
visible) · spec 198 (multiline `รับเข้า` — the manual grid, now only for the legacy straggler) ·
spec 208 / ADR 0065 (store-first) · spec 24 / ADR 0030 (photo-completes-delivery) · #456
(delivery-photo storage-RLS fix that unblocked SA uploads to `pr-attachments`).
