# Spec 308 — The delivery receive surface: ของเข้า owns receiving end-to-end

- Status: Approved direction (2026-07-12, AskUserQuestion) — **build next session**.
  Operator root-cause insight: "Reusing จัดซื้อ page maybe the root cause of this
  problem. จัดซื้อ is supposed to be all about the orders made from the WP. ของเข้า
  is supposed to be about deliveries."
- Locked decisions: ① build the dedicated receive page ② goods photos = **both**
  — a required truck-level photo set per delivery PLUS optional per-item photos
  for exceptions (damage/shortage) ③ the PR page's receive card **shrinks to a
  link** — one receiving surface.

## Problem (the IA root cause)

`/requests/[id]` is the จัดซื้อ surface — a WP-raised order's lifecycle
(decision, PO, procurement docs, payment). But ของเข้า cards deep-link INTO it
for receiving, so the SA receives inside procurement's world. Specs 302–304
role-gated that shared page (correctly, given its shape) — 307 removes the
shape problem: receiving gets its own surface keyed by the DELIVERY, and the
per-role patching pressure disappears.

## Design

New route **`/projects/[projectId]/incoming/[deliveryId]`** — one arrival, one
page (reached from the spec-305 delivery cards; ของเข้า tile → cards → receive):

- **Header:** supplier · ETA (+ เลยกำหนด) · carrier/note from
  `purchase_order_deliveries` (the join spec 305 deferred).
- **Item checklist:** the delivery's PR lines, ALL TICKED by default (mirrors
  the PO receive checklist, spec 134 U5); untick what didn't arrive; แบ่งรับ
  split control per line as today. Confirm = `receivePoLines` on the ticked
  ids → `delivered` → the spec-195-P3 trigger auto-books store receipts.
  **No new money path.**
- **Truck photo set (required):** live-camera (`capture="environment"`,
  spec 303) photos of the whole load — attach **delivery-scoped** via the
  existing `purchase_order_attachments.delivery_id` proof model (spec 135
  U4/U5; the BO delivery page already renders this gallery, so both sides see
  one photo set). Confirm gates on ≥1 truck photo (photo-always doctrine,
  spec 300).
- **Per-item photos (optional, exceptions):** each line row keeps a small
  add-photo affordance writing today's per-PR `delivery_confirmation` — for
  damaged/short/wrong items. Spec-303 qty caption stays on the PR page.
- **Paper capture:** ใบส่งของ/ใบเสร็จ photo on this page. v1 = attach to every
  ticked line's PR (`purpose='invoice'`, current storage layout) unless the
  plan finds a cleaner delivery-scoped home; decide at plan time, don't
  duplicate bytes silently.
- **PR page (`/requests/[id]`):** the การรับของ card shrinks to status +
  spec-303 flags + a **รับของ link** to this page (via the line's
  `delivery_id`; a delivery-less line keeps the inline card as fallback).
- **ของเข้า lifecycle:** delivered lines drop off incoming today; the plan
  should keep the arrival card visible (state รับแล้ว) same-day so the SA can
  reopen it — decide exact retention at plan time.

## Gate-1 findings (verified LIVE 2026-07-12 — NO schema unit needed)

1. ✅ `receive_po_lines` RPC already admits **site_admin** ("Receiving is a
   site action" — site_admin/PM/super/director + procurement, spec 208 Q3).
2. ✅ `purchase_order_attachments` INSERT policy already includes site_admin
   (+ created_by=self + parent-PO-exists; the policy NAME says "back office"
   but the role array is wider — stale name only).
3. ✅ storage `po-attachments` upload policy already includes site_admin
   (single-folder = poId path enforced).
4. ✅ `purchase_order_deliveries` SELECT already includes site_admin (role-only
   scope — pool-level read, same accepted grain as equipment_movements).

**Spec 308 is therefore CODE-ONLY** — no migration, no guard-held PR. The
original U1 assumption is refuted by evidence; units renumber:

- **U1 (code):** the receive page (header + checklist + truck capture +
  paper capture) + ของเข้า card links → here + nav-back-affordance guard.
  Uploader contract (ProofOfDeliveryUploader reuse vs a capture-bracketed
  variant with the spec-37 offline queue) decided at plan time.
- **U2 (code):** PR-page receive card shrink-to-link + per-item exception
  photo affordance + retention polish.
- ⚠️ Coordinate with the spec-307 arrival-grouping lane (day×supplier card
  grain, in flight) — the card→receive-page links land on whichever card
  shape merged first; whoever merges second resolves.

## Out of scope

- Procurement's PO/delivery pages (they already have the งวด proof gallery).
- Any GL/money change — receiving still books through the existing trigger.
- AI photo-coverage check (spec 303 seam, unchanged).

## References

Operator directives 2026-07-12 (this file's header) · specs 302–305 (the
patches this supersedes structurally) · spec 135 U4/U5 (delivery-scoped proof
model) · spec 134 U5 (receive checklist UX) · spec 24 / ADR 0030 + spec 195 P3
(photo/receive → store receipt) · #456 (storage-RLS lesson for SA writes).
