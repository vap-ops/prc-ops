# Spec 307 — ของเข้า arrival grouping (day × supplier)

**Status:** building (2026-07-12)
**Follows:** spec 305 (ของเข้า by delivery), spec 300 U4 (`/incoming` surface)
**Operator report (2026-07-12):** "ของเข้า page does not group the PR items, making it
confusing how many packages will arrive that day."

## Problem

Spec 305 groups the ของเข้า surface by `delivery_id` (งวดส่ง). That grain is
procurement paperwork, not physical arrival: the drawer's quick "บันทึกซื้อ" action
(spec 120) mints a **one-line PO per PR**, and `create_purchase_order` auto-creates
one delivery per PO — so in practice most deliveries carry exactly one PR line
(live: 24 of 55 deliveries are singletons). Result: one card per item, and no
answer to "how many packages arrive today?"

## Fix (presentation-only, no schema)

Regroup the ของเข้า list by **(ETA day × supplier)** — one card ≈ one expected
physical arrival — under **day headers with arrival counts**.

### U1 (this unit, code-only)

1. **Seam** — `src/lib/store/incoming.ts` gains `selectIncomingArrivals(rows, lens, todayIso)`:
   - builds on `selectStoreIncoming` (lens filter is item-level, unchanged — spec 300 U1 semantics);
   - groups items by the item's **own** `eta` date, then by `supplier` within the day;
   - day order: ascending, unknown-ETA day **last**; arrivals within a day keep
     first-seen (due-first) order; items inside an arrival keep due-first order;
   - `IncomingDayGroup { day, isToday, overdue, arrivals }`,
     `IncomingArrivalGroup { key, supplier, status, overdue, itemCount, deliveries }`,
     `IncomingArrivalDelivery { deliveryId, items }`;
   - arrival `status` = `on_route` if any member shipped, else `purchased`;
     arrival/day `overdue` = eta before today;
   - group key `${day ?? "noeta"}|${supplier==null?"none":"s:"+supplier}` — a real
     supplier is prefixed `s:` so no free-text name can collide with the null key.
   - `delivery_id` no longer drives arrival grouping, BUT items stay sub-grouped
     by delivery **inside** each arrival — this is the spec-308 receive unit (see
     §Compose). `selectIncomingDeliveries` stays exported (spec 305 tests pin it;
     now unused in prod → removal is a follow-up).
2. **Component** — `store-incoming-list.tsx` renders day sections: header = Thai
   date (+ "วันนี้" marker when today, `เลยกำหนด` danger flag when past) + count chip
   of arrivals that day; each arrival card = supplier + `· N รายการ` + status; inside,
   items are grouped by delivery, each real delivery showing a spec-308 `รับของ`
   receive link, then its item rows (each still linking to `/requests/[id]`). Top
   badge counts ALL arrival cards. Count chips carry an aria-label (`storeIncomingCountAria`).
3. **Page** — `/projects/[projectId]/incoming/page.tsx` swaps
   `selectIncomingDeliveries` → `selectIncomingArrivals`; keeps the spec-308
   `receiveHrefFor` prop. Query unchanged.
4. **Labels** (`labels.ts`, ADDITIVE only): `STORE_INCOMING_DAY_TODAY` (วันนี้),
   `STORE_INCOMING_DAY_UNSCHEDULED` (ยังไม่ระบุกำหนดส่ง), `storeIncomingCountAria`.
   Reuses spec-308 `DELIVERY_RECEIVE_PAGE_TITLE` (รับของ).

### Compose with spec 308 (shipped #486 mid-session)

Spec 308 shipped a per-**delivery** receive page (`/incoming/[deliveryId]`) with a
`รับของ` link on each delivery-grain card, under the doctrine "ของเข้า is about
deliveries." Spec 307 regroups the card to (day × supplier), which can span several
deliveries. Reconciliation (operator asked for the recommendation): **keep the
arrival grain for counting** (answers "how many packages that day"), **and preserve
308's per-delivery receiving** by sub-grouping each arrival's items by delivery —
one `รับของ` link per delivery. The common single-delivery arrival is visually
308 + a day header; a supplier that genuinely ships several deliveries the same day
shows one receive link each (they are separate receipts in 308's model). 308's
receive page is untouched; only its "card = delivery" framing softens to
"receive action = delivery."

### Non-goals (follow-ups, listed not built)

- PO-builder nudge (offer same-supplier approved PRs when pre-seeding the
  one-line PO sheet) — separate unit.
- Removing `selectIncomingDeliveries` + its tests — separate cleanup unit.
- The 200-line cap remains PR-line-grained (spec 305 seam note unchanged).

## Verification checklist

- [ ] Vitest RED first for `selectIncomingArrivals` (day split, supplier split,
      null-eta last, overdue/status derivation, lens interplay) + RTL render of
      day headers/counts.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green (full suite).
- [ ] Guard suites (design-doctrine, nav-back-affordance, ui-class-contracts) green.
- [ ] Browser: /incoming renders grouped days (dev-preview login).

## Trade-off (accepted by operator 2026-07-12)

Two same-day trucks from one supplier merge into one card. Items are all listed
and each still opens its own receive card, so receiving is unaffected.
