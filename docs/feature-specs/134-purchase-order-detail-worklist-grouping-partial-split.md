# Spec 134 — Purchase orders: detail page, worklist PO grouping, within-ticket partial via split

- Status: Draft (2026-06-17)
- Owner decision (this session): operator chose **PO detail + worklist grouping**
  (no new primary tab) for PO viewing, and **across-ticket roll-up for ~98% of
  cases, with split-on-receipt for the 1–2% within-ticket partial**.
- References:
  - ADR 0044 — purchase orders: grouping tickets into a supplier order. This spec
    builds the **viewing** layer it deferred (§7 "later receipts unit") via the
    split mechanic in Unit 3.
  - Spec 115 — PO data layer (table, FK, RLS, `create_purchase_order` RPC, derived
    helpers in `src/lib/purchasing/purchase-order.ts`). **Shipped.**
  - Specs 116/117/118/120 — create-PO UI + phone basket + unified purchase
    recording. **Shipped.**
  - Spec 104 — procurement worklist bands (`src/lib/purchasing/procurement-pipeline.ts`).
  - Specs 22/23/24 — order tracking + delivery-confirmation photos (the existing
    per-ticket delivery path the split reuses).
  - Spec 47 — purchase-request detail page (`/requests/[requestId]`) — the
    drill-down pattern Unit 1 mirrors.

## Problem

POs exist as **data** only (spec 115): `derivePurchaseOrderStatus` and
`purchaseOrderTotal` are computed, but **no screen views a PO as a unit**. Once
tickets are bundled (spec 118 phone basket / spec 116 grid), the PO — the artifact
sent to the supplier and received against — is invisible: its member tickets scatter
back into the กำลังจัดส่ง band as loose rows. There is also no in-app way to handle
a partial delivery **within** one ticket (ordered 100, 50 arrives now).

## Scope (three units, built one per session)

- **Unit 1** — PO detail page (read-only view of a PO and its lines).
- **Unit 2** — worklist กำลังจัดส่ง band groups bundled tickets by PO.
- **Unit 3** — within-ticket partial delivery via split-on-receipt. **GATED:**
  touches the data model + amends ADR 0044 §7 → requires a short ADR accepted
  before build (see Unit 3).

Out of scope (carried from ADR 0044 §7, still deferred): a cumulative
`quantity_received` receipts ledger (rejected for this build — see Unit 3 rationale);
editing a PO's line set after creation; PO PDF; cross-instance/tenancy.

---

## Unit 1 — PO detail page

A read-only drill-down for one PO. Reached from a member ticket and (after Unit 2)
from the worklist. **No new primary tab** — it lives under the purchasing surface.

### Route

`app/requests/orders/[poId]/page.tsx` → URL `/requests/orders/<poId>`.

- Kept **under `/requests`** so PO viewing reads as a drill-down from the purchasing
  surface, not a fourth procurement tab (operator decision). Nav identity stays
  `/requests`; this page carries a spec-12 contextual back-bar (to `/requests`), not
  a HubNav strip — mirroring `/requests/[requestId]`.
- Static segment `orders` takes priority over the sibling dynamic `[requestId]`
  in the App Router, so `/requests/orders/x` resolves here and other
  `/requests/<id>` paths keep resolving to the ticket detail. (Confirm against the
  current Next.js routing docs before building — see CLAUDE.md "This is NOT the
  Next.js you know".)

### Access

`requireRole(PURCHASING_ROLES)` — `site_admin` / `project_manager` / `procurement` /
`super_admin`, matching the `purchase_orders` SELECT RLS (spec 115 §3 / ADR 0026).
RLS is the real gate; the page guard is the redirect-on-unauthorized convenience.

### Data

Server Component. Two reads under the user session (RLS admits back office):

1. The PO: `select id, po_number, supplier, supplier_id, eta, ordered_at, notes,
created_by, created_at from purchase_orders where id = poId` (`maybeSingle()` →
   null when not found or RLS-filtered; render not-found).
2. Its member tickets: `purchase_requests where purchase_order_id = poId`, selecting
   the same line columns the grid record uses (`pr_number, item_description,
quantity, unit, status, priority, eta, needed_by, requested_at, purchased_at,
shipped_at, delivered_at, work_package_id` …), plus WP code/name resolved the way
   the requests list does (separate `work_packages` query → `Map`).

**Amount is money.** Per-line amounts and the PO total are read **only** via the
admin client, gated to the page's back-office roles, exactly as
`/requests` does today (spec 106 posture). `purchaseOrderTotal(lineAmounts)` computes
the total; never store it.

`derivePurchaseOrderStatus(memberStatuses)` gives the header status badge. Exclude
rejected/cancelled members from both status and total (the helper already excludes
them from status; filter them out before summing for the total).

### UI

- Header: `PO #<po_number>`, supplier, ETA, ordered date, derived status badge
  (open / ordered / partially_received / received → Thai labels), PO total, line
  count, notes (if any).
- Line list: one row per member ticket — item, qty + unit, status mini-bar (reuse
  the shared order-stage helper from spec 111), amount (back office), WP chip linking
  to the WP, link to the ticket detail `/requests/[requestId]`.
- Field-First tokens only (memory: design system); no raw Tailwind palette.

### Linking in (from the ticket)

On `/requests/[requestId]`, when `purchase_order_id` is set, show a
"ส่วนของใบสั่งซื้อ PO #<n> →" link to the PO detail. Small addition; keep it to the
link only (scope discipline — no ticket-detail redesign here).

### Tests (test-first)

- Unit: a pure view-model builder (e.g. `buildPoDetailView(po, lines, amountById)`)
  returning `{ status, total, lines: [...] }` — assert status roll-up, total sum,
  rejected/cancelled exclusion, null-amount handling. Write this failing first.
- E2E (Playwright): a back-office user opens a PO detail and sees the header status,
  total, and one row per member; the ticket link navigates to `/requests/[id]`.

---

## Unit 2 — worklist กำลังจัดส่ง band groups by PO

In the procurement worklist, bundled in-transit tickets (`purchase_order_id` not
null) collapse into one **PO group**; loose tickets (no PO) render as today.

### Helper (pure, test-first)

Add to `src/lib/purchasing/` a pure grouper, e.g.:

```ts
// Within a band's rows, split into PO groups (purchase_order_id non-null,
// keyed by PO) and loose rows (null). Order: POs by earliest member, then loose.
groupByPurchaseOrder<T extends { purchase_order_id: string | null }>(
  rows: ReadonlyArray<T>,
): { poGroups: Array<{ poId: string; items: T[] }>; loose: T[] }
```

`purchase_order_id` must be added to `PR_LIST_COLUMNS` (and the grid record / card
props) so the worklist rows carry it. The PO's display facts (po_number, supplier,
derived status, total, ETA) come from a batched `purchase_orders` read keyed by the
distinct PO ids in the band (+ the admin amount read already in `/requests` for the
group total).

### Surfaces

Apply grouping to the **in_transit** band only (the band where bundling matters;
to_order bundling is the create-PO flow, already shipped). Both surfaces:

- Phone card pipeline: a PO renders as a single **PO card** (po_number, supplier,
  derived status, line count, total, ETA) linking to the Unit-1 detail; member
  tickets nest under it (collapsed summary). Loose rows render as the existing
  `PurchaseRequestCard`.
- Desktop `ProcurementGrid`: member rows of a PO render under a PO group header row
  (po_number · supplier · status · total); a header click opens the PO detail.

Keep `received` / `to_order` / `awaiting_approval` bands unchanged. If grouping both
surfaces is too large for one session, split: **2a** = helper + phone cards,
**2b** = desktop grid. Note the split in the progress tracker; do not silently cap.

### Tests (test-first)

- Unit: `groupByPurchaseOrder` — mixed bundled/loose rows, multiple POs, ordering,
  all-loose, all-one-PO. Write failing first.
- E2E: an in-transit PO with ≥2 members shows as one group/card; tapping reaches the
  PO detail.

---

## Unit 3 — within-ticket partial delivery via split-on-receipt ⚠️ GATED

Handles the 1–2% case: a single ticket's quantity arrives in parts. **This amends
ADR 0044 §7** (which deferred "split quantity → a receipts/`quantity_received`
unit") and adds a column + an RPC → it is an architectural decision. **Write the ADR
and get it accepted before building** (CLAUDE.md: architectural choices not in a
spec are raised before implementation). Grab the next free ADR number from
`docs/decisions/README.md`.

### Approach — split, not a receipts ledger

When a partial arrives, **split the ticket into a delivered portion and a remaining
portion**, both members of the same PO. Rationale for split over a cumulative
`quantity_received` ledger, given the 1–2% frequency:

- The across-ticket roll-up (`derivePurchaseOrderStatus`) and Units 1–2 **already**
  render `partially_received` from ordinary member statuses. A split produces two
  ordinary tickets → the PO shows `partially_received` with **zero** new
  derive/display logic.
- A receipts ledger means a new table + RLS + cumulative-vs-ordered derivation +
  partial-qty display everywhere — heavy infrastructure that fires 1–2% of the time.
  Rejected as over-build for the frequency the operator confirmed.

### Mechanic

A guarded `SECURITY DEFINER` RPC, e.g. `split_purchase_request_on_receipt(
p_request_id uuid, p_received_qty numeric, p_received_by text, p_delivery_note text)`:

- Runs on the **authenticated session** (the spec-68 / ADR 0044 §4 lesson:
  role-gated DEFINER RPCs need a non-null `auth.uid()`); role-gate to back office
  via `current_user_role()`. `grant execute to authenticated`; no direct table
  write policy (ADR 0038 fact-column posture).
- Guards: the target is an in-transit member (`status in ('purchased','on_route')`)
  with `purchase_order_id` set; `0 < p_received_qty < quantity` (equal-or-greater is
  a **full** delivery → reject, route to the existing delivery path).
- Effect (all-or-nothing in one transaction):
  - The **original** row becomes the **delivered portion**: `quantity =
p_received_qty`, `status = 'delivered'`, `delivered_at = now()`, `received_by`,
    `delivery_note`.
  - A **new child** row carries the **remaining portion**: `quantity = original −
p_received_qty`, `status = 'on_route'`, same `purchase_order_id`,
    `work_package_id`, `supplier`/`supplier_id`, `item_description`, `unit`,
    `priority`, `eta`, `needed_by`; new `pr_number`; `split_from_request_id` =
    original id.
  - The child can itself be split again later (chain handles repeated partials).
  - One audit row recording the split (original id, child id, received/remaining qty,
    original ordered qty) so the original ask is reconstructable.
- New column: `purchase_requests.split_from_request_id uuid null references
purchase_requests(id)` — explicit lineage; the original ordered qty for a line =
  sum over its split family.

### UI

A **"รับบางส่วน"** action on each in-transit line in the PO detail (Unit 1) — qty
received + optional delivery note. Full delivery keeps the existing
confirmation-photo path (spec 24). After a split, the detail re-renders: delivered
child + remaining child, PO badge → `partially_received` (free, via the roll-up).

### Open decisions for the ADR (resolve before build)

1. **Amount split.** Each ticket carries its own `amount` (money). On split, does
   the delivered portion keep the full amount, or split proportionally by qty?
   _Proposed default:_ proportional by qty with exact reconciliation (delivered =
   `round(amount × received/ordered)`, remaining = `amount − delivered`) so the
   family sum is exact and per-WP spend (specs 100/103/106) is unchanged. **Confirm
   with operator/accounting.**
2. **Delivery photo on the partial.** Does the delivered portion require/accept a
   confirmation photo (spec 23/24 consistency), or is qty + note enough for the
   partial path? _Proposed:_ photo optional on the partial, attached to the
   delivered child like any delivered ticket.
3. **Which row keeps identity.** Proposed above = original becomes delivered, child
   carries remainder. Alternative (original stays as the "as-ordered" record, two
   children created) is cleaner for audit but costs an extra row and a status the
   enum doesn't model. Default to the proposed; record the rejected alternative.

### Tests (test-first)

- pgTAP: the split RPC — role gate (back office only; `appsheet_writer` /
  unauthenticated refused), qty guards (0 / equal / over → reject), correct
  delivered+remaining quantities, `split_from_request_id` set, both rows share the
  PO, amount reconciliation exact, one audit row, all-or-nothing rollback on a bad
  line. Write failing first.
- Unit: client-side qty validation (`0 < received < ordered`).
- Integration/E2E: partial receipt on a PO line → PO badge becomes
  `partially_received`; remaining line still in transit.

---

## Unit 4 — proof-of-delivery attachments + courier dispatch (FUTURE; research done)

Operator ask (2026-06-17): "proof attachments too" + "check Lalamove API, we will
apply in the future soon". Research is captured in
`docs/research/lalamove-api-2026-06.md` (auth, endpoints, webhooks, POD retrieval,
TH vehicle tiers, billing, blockers). It is **not built** — it grounds a future
spec/ADR. Key design seams from that doc:

- **Proof attachment = new purpose `proof_of_delivery`**, distinct from the existing
  crew-captured `delivery_confirmation` photos (carrier-generated provenance).
  Anchored at the PO/dispatch level, fanned out by reference to the delivered
  tickets; the Lalamove POD photo/signature is **copied into our Storage** (their
  URL is assumed signed/expiring), recipient + `deliveredAt` as metadata; same
  append-only/supersede discipline.
- **A manual proof-of-delivery uploader is buildable NOW**, independent of Lalamove
  (crew uploads a signed delivery note / photo at the PO detail). Lalamove POD later
  auto-populates the same purpose. **Decision pending with operator:** ship the
  manual proof slot near-term, or wait and land both with the courier integration.
- **Dispatch is provider-abstracted** (mirror the spec-128 bank-disbursement
  pattern): a `DeliveryProvider` interface (`LalamoveProvider` first impl), an
  outbound `delivery_dispatch_outbox` + an inbound `delivery_webhook_inbox` (reusing
  the `notification_outbox` / `peak_sync_outbox` patterns). Lalamove order status →
  our `purchased → on_route → delivered` lifecycle, fanned out from the PO.
- **Blocked on** Lalamove sandbox creds + partner-support answers (KYC, billing,
  exact POD schema, inbound-webhook signature) — see research §8.

## Verification checklist

Per unit: `pnpm lint && pnpm typecheck && pnpm test` all green; new pure helpers
unit-tested (test written first); Unit 3 also `pnpm db:test` (pgTAP) green and its
ADR accepted + migration applied under the change-management gate.

- Unit 1: PO detail renders header status/total + one row per member; ticket links
  work; amounts only via admin read gated to back office; not-found path clean.
- Unit 2: in-transit bundled tickets group by PO on phone + desktop; loose tickets
  unchanged; other bands untouched.
- Unit 3: ADR accepted; split produces delivered + remaining members of the same PO;
  roll-up shows `partially_received`; amount family-sum exact; audit row written.

## Open questions

- Unit 1 route: `/requests/orders/[poId]` (chosen — keeps PO viewing inside the
  purchasing surface, no new tab). Flag if a future PO **register** (search by
  supplier / PO# / outstanding) is wanted — that would be the moment to promote it
  to its own destination; reserved, not built here.
- Unit 3 amount-split + photo-requirement decisions (above) belong in the ADR, not
  this spec.
