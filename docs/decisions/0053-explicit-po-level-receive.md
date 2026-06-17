# ADR 0053 — Explicit PO-level receive (delivery completion without a per-ticket photo)

- Status: Accepted (2026-06-17). Operator-approved design (the 85/14/1 delivery-case
  breakdown). Implemented by spec 134 Unit 5.
- Amends: ADR 0030 (site receipt photo completes delivery) — extends, does not
  remove, that path.
- Context: today the ONLY way to mark a `purchase_request` delivered is to upload a
  delivery-confirmation photo (spec 23/24/ADR 0030 — a trigger on the photo sets
  `delivered_at`, the derive trigger flips status to `delivered`). The operator's
  real delivery distribution against a PO:
  - **Case A (~85%):** the whole PO arrives in one delivery.
  - **Case B (~14%):** the PO arrives in two deliveries, split at the TICKET level
    (some items out of stock wait a few days) — each ticket still delivers whole.
  - **Case C (~1%):** the same item (one ticket) dribbles in over several deliveries
    (made-to-order) — the within-ticket split (ADR 0052 / spec 134 U3).
    So the photo-per-ticket model makes the 85/14% common cases tedious (one photo per
    line) while the 1% within-ticket split (U3) is the prominent control — backwards.

## Decisions

1. **Delivery can be completed by an EXPLICIT receive action, not only a photo.** A
   PO-level receive marks the chosen in-transit members delivered directly (sets
   `delivered_at` → the existing derive trigger advances purchased|on_route →
   delivered; the audit trigger logs each delivery). The spec-24 photo-completes-
   delivery path stays unchanged for ad-hoc single-ticket receipt.

2. **Evidence = the PO-level proof-of-delivery attachment (spec 134 U4a), optional.**
   One proof photo covers the whole delivery (the buyer attaches it on the PO detail),
   replacing the per-ticket photo grind. The receive action does not REQUIRE a photo —
   recording receipt must never be blocked on bookkeeping (the ADR 0027 stance).

3. **Mechanic: one `receive_po_lines(p_request_ids uuid[], p_received_by,
p_delivery_note)` SECURITY DEFINER RPC.** Authenticated session, back-office gate;
   each id must be an in-transit member (`status in ('purchased','on_route')`); sets
   `delivered_at = now()`, `received_by`, `delivery_note`; all-or-nothing. No new
   column — it writes the existing delivery facts and leans on the existing triggers
   (so each line gets the standard `purchase_request_delivery` audit row for free).

4. **UX (the point of this ADR):**
   - Case A: a "รับของ" checklist of in-transit lines, **all ticked by default** →
     confirm receives the whole PO in one action.
   - Case B: untick the lines still waiting → receive the arrived subset; the rest
     stay on_route for the next delivery, the PO shows `partially_received` (the
     roll-up — no new logic).
   - Case C: the within-ticket split (U3) is **demoted** to a small per-line link
     ("แบ่งรับ"), out of the common path.

5. **Out of scope:** per-delivery shipping cost ("sometimes paid, sometimes free") —
   deferred to the courier work (spec 134 U4b / Lalamove), operator decision
   2026-06-17. Undo-a-receive (a mis-received line) reuses the existing correction
   posture; a reverse path is a later seam.

## Why not the alternatives

- **Keep photo-per-ticket as the only path.** Makes the 85/14% cases N photo uploads
  per PO. Rejected — the common case must be one tap (decision 1).
- **Require a photo to receive.** Couples receipt to the storage/upload flow and
  blocks recording when signal is bad. Rejected — photo is optional evidence
  (decision 2), consistent with ADR 0027 (delivery never blocked on bookkeeping).
- **Per-delivery receipt entity (a deliveries table).** A first-class delivery/
  shipment record (with its own cost, carrier, POD) is the courier-era model
  (U4b) — over-built for marking whole tickets delivered today. Rejected for U5;
  reconsidered when Lalamove dispatch lands.

## Consequences

One new SECURITY DEFINER RPC + a redesigned PO-detail receiving section; no new
column, no change to the roll-up or the spec-24 photo path. The migration ships under
the change-management gate (migration + reviewed PR + operator `db:push`); pgTAP
proves the RPC: role gate, in-transit-only guard, multi-line receive sets the
delivery facts + advances status, all-or-nothing on a bad line.
