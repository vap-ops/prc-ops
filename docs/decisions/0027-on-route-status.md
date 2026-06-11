# ADR 0027 — `on_route` purchase-request status

**Status:** Accepted — 2026-06-11. Spec 22.

## Context

Spec 22 adds an order-tracking stepper to every purchase request. The
operator wants an explicit "กำลังจัดส่ง" (on route) stage. Two options:

1. **Display-only stage** derived from `status = 'purchased' AND eta IS
NOT NULL` — no schema change, but it conflates "procurement promised a
   date" with "the goods physically shipped", and the stage can never be
   trusted for ops decisions.
2. **Real enum value** derived from a new fact column, consistent with
   ADR 0025's "status is derived from facts, never written by AppSheet"
   posture.

Operator explicitly chose (2) in chat, 2026-06-11.

## Decision

- `purchase_request_status` gains `on_route`, ordered after `purchased`.
  Lifecycle: requested → approved → purchased → on_route → delivered;
  rejected unchanged; **on_route is skippable** — purchased → delivered
  remains a legal transition because back offices won't always record a
  shipment moment, and blocking delivery on a bookkeeping step would
  punish the field.
- New fact column `purchase_requests.shipped_at timestamptz NULL`,
  UPDATE-granted to `appsheet_writer` (9th granted column). The derive
  trigger maps `purchased` + `shipped_at` null→non-null ⇒ `on_route`, and
  widens the delivery guard to `old.status IN ('purchased','on_route')`.
- Guard: `shipped_at` may only transition null→non-null while status is
  `purchased` (corrections to an already-set value stay allowed, matching
  the purchased_at pattern).
- **No new `audit_action` enum value.** The purchased→on_route transition
  is audited as action `'update'` with payload
  `{principal, shipped_at, transition: ['purchased','on_route']}`.
  Rationale: the action enum is append-only surface area shared with
  dashboards; a shipment is operationally a fact-correction-grade event,
  not a money event like purchase/delivery which keep their dedicated
  actions. If shipment auditing later needs first-class querying, a
  follow-up ADR can add the action and backfill from payloads.
- `on_route → delivered` reuses the existing `purchase_request_delivery`
  audit case unchanged.

## Consequences

- Two migrations (enum value must commit before first use).
- AppSheet column config must expose shipped_at (operator task; Tier-2
  smoke ritual re-run per the role-touching-migration rule).
- App regenerates `database.types.ts` post-push; UI gains the stage in
  labels, pill colors, and the spec-22 tracker.
- Rows already `delivered` keep `shipped_at IS NULL` — the tracker
  renders that stage as passed-without-date rather than pretending a
  timestamp exists.
