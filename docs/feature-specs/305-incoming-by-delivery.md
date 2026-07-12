# Spec 305 — ของเข้า lists deliveries, not PR lines

- Status: Approved (2026-07-12). Operator: "I think the items shown in today's
  delivery should be from delivery table, not PR table. A delivery may naturally
  include many PR items."
- **Code-only, no schema.** Reshapes the spec-300 U3/U4 incoming surface.

## Problem

`/projects/[id]/incoming` (ของเข้า) renders one row per `purchase_requests` line.
A real delivery (งวดส่ง — `purchase_order_deliveries`, spec 148) carries many PR
lines at once: the SA meeting one truck sees N unrelated-looking rows instead of
one arrival. The delivery entity already exists and is populated
(`purchase_requests.delivery_id` — 100% of current incoming store-bound PRs carry
it), so this is purely a presentation-shape fix.

## Change (single unit, code-only)

1. **Selector:** new pure `selectIncomingDeliveries(rows, lens, todayIso)` in
   `src/lib/store/incoming.ts`, built on the existing (tested) item-level
   `selectStoreIncoming`: lens-filter rows first (semantics unchanged), then
   group survivors by `delivery_id`; a null-`delivery_id` row forms its own
   singleton group (legacy/unscheduled). Group fields: earliest member `eta`
   (null last), `overdue` = any member overdue, `status` = `on_route` when any
   member shipped, supplier from the members, items in due-first order. Groups
   sorted due-first. Raw shape + row gain `delivery_id`.
2. **Query:** the incoming page selects `delivery_id` too. Still the
   `purchase_requests` read under viewer RLS — no new table read needed; the
   delivery id is the grouping key. (Carrier/note from
   `purchase_order_deliveries` = later polish if wanted.)
3. **UI:** `StoreIncomingList` renders one card per delivery group: header =
   supplier + status + ETA (+ เลยกำหนด flag) + `N รายการ` count badge for
   multi-item groups; body lists the items (name · qty unit), each item linking
   to its `/requests/[id]` receive card as today. Lens chips + empty state
   unchanged.

## Out of scope / seams

- No delivery-level receive action (receiving stays per-PR — the photo-completes
  mechanic, spec 24; a "receive whole delivery" batch = future unit if asked).
- No join to `purchase_order_deliveries` for carrier/note/cost.
- The `/requests` worklist band and PO pages unchanged.

## Verification

- TDD: grouping matrix (multi-line delivery = one group; null delivery_id =
  singleton; lens filter before grouping; group eta/overdue/status derivation;
  due-first group order).
- Full suite + guards green; browser: /incoming shows one card per delivery with
  its items listed; item links open receive cards. Zero console errors.

## References

Spec 300 U3/U4 (the surface) · spec 148 (purchase_order_deliveries / งวดส่ง) ·
spec 24 / ADR 0030 (per-PR receive stays) · operator directive 2026-07-12.
