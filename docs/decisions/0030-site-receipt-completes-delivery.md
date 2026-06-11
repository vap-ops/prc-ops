# ADR 0030 — Site receipt photo completes delivery

**Status:** Accepted — 2026-06-11. Spec 24. Amends ADR 0028 (its
"delivered-only" confirmation-photo gate) and extends the ADR 0025/0027
derive chain.

## Context

ADR 0028 gated delivery-confirmation photos on `status = 'delivered'`,
keeping AppSheet the sole delivery authority. The operator's field
reality (2026-06-11): "when status is on_route, users on site can attach
images, then we know delivery is complete." The people who know goods
arrived are on site holding the goods — not procurement. Waiting for the
back office to record delivery before the site can attach evidence is
backwards.

## Decision

The receipt photo becomes a delivery-completing FACT, consistent with
the ADR 0025 doctrine (facts in, status derived by trigger):

- The attachments INSERT-policy confirmation branch widens from
  `status = 'delivered'` to `status in ('on_route', 'delivered')`
  (delivered stays legal — adding more photos after completion). The
  storage upload policy widens identically.
- New `AFTER INSERT` trigger on `purchase_request_attachments`
  (SECURITY DEFINER, search_path pinned — ADR 0011 checklist): when a
  CONTENT row with `purpose = 'delivery_confirmation'` lands and the
  parent is `on_route`, it sets `delivered_at = now()` and
  `received_by = users.full_name` (fallback: the creator uuid) on the
  parent. The EXISTING derive trigger then advances
  `on_route → delivered`, and the EXISTING audit trigger writes the
  `purchase_request_delivery` row — one mechanism, no new status-writing
  path. SECURITY DEFINER is required (authenticated has no UPDATE grant
  on purchase_requests delivery columns — the privilege posture is
  unchanged; the trigger is the only path, exactly like the AppSheet
  derive path).
- `purchased` (not yet shipped) does NOT accept confirmation photos —
  the operator's stated flow starts at on_route. If procurement skips
  recording shipment, delivery still completes only via AppSheet.
  Recorded as an open question (tracker) rather than assumed.
- AppSheet's own delivered_at write path is untouched — both paths
  converge on the same facts; whichever happens first completes the
  delivery, the other becomes a correction.

## Consequences

- Audit: app-originated deliveries carry
  `payload->>'principal' = 'authenticator'` (PostgREST session user) vs
  `'appsheet_writer'` for back-office deliveries — the principal now
  legitimately distinguishes the two delivery paths; recorded here, and
  the Tier-2b interpretation note gains this caveat.
- The tombstone rule "creator-only while parent is delivered" gains the
  on_route window implicitly (the policy's target check is
  status-agnostic for tombstones via the helper); a photo attached
  on_route flips the parent to delivered in the same transaction, so in
  practice removal still happens on delivered parents.
- TOCTOU sibling recorded in ADR 0028 §Consequences now has a third
  member: a photo whose snapshot saw on_route can land just after
  AppSheet's delivered correction — converges harmlessly (correction
  path, no transition).
- ADR 0028's "parent `status = 'delivered'`" clause carries an
  "amended by ADR 0030" pointer.
