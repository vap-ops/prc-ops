# ADR 0064 — Divert a delivered WP-bound purchase into the store (cost transfer WP-WIP → Inventory) (extends ADR 0063, spec 198 U2)

## Status

Accepted (2026-06-24). Operator decision, spec 198 U2 (AskUserQuestion — "divert
WP-bound → store with a GL move").

## Context

ADR 0063 + spec 195 P3 made purchasing project-aware: a **WP-less** (store-bound)
purchase request is received into the on-site store — its receipt books the
material as Inventory (Dr 1500 / Cr 2100 AP) and the WP-WIP purchase posting is
suppressed; a later เบิก moves the cost Dr 1400 WP-WIP / Cr 1500 Inventory, so a
WP's material cost lands once, at usage.

A **WP-bound** purchase still expenses at purchase: `post_purchase_to_gl` posts
Dr 1400 WP-WIP / Cr 2100 AP when it reaches `purchased`/`site_purchased`, so the
WP carries the cost immediately (ADR 0022 model).

The operator wants the on-site storekeeper to be able to take a **delivered
WP-bound** line and **put it in the store instead** — the material physically
arrives but isn't consumed by that WP yet, so it should become store stock and be
เบิก'd (to that WP or another) later. Today there is no path: re-recording it as a
manual stock-in would book Dr 1500 Inventory a second time while the cost already
sits in the WP's WIP — a **double-count**. So the move needs a **cost transfer**,
not a second booking.

## Decision

Add an inventory-**diversion** operation: a delivered, WP-bound, catalogued PR
line can be **moved into the store**, transferring its cost from the WP to
Inventory. Net effect:

```
reverse the WP purchase :  Dr 2100 AP        / Cr 1400 WP-WIP   (undo WP cost)
new stock_receipt       :  Dr 1500 Inventory / Cr 2100 AP       (book as stock)
-------------------------------------------------------------------------------
net: WP-WIP → 0 · Inventory + cost · AP unchanged (still one liability)
```

A subsequent เบิก returns it Dr 1400 WP-WIP / Cr 1500 Inventory (spec 177/178), so
the WP's material cost still lands exactly once, at usage — the store-bound model.

**Mechanism** — reuse the existing async GL outbox + `drain_gl_posting`; do not
invent a parallel posting path:

1. A definer RPC `divert_purchase_to_store(p_request_id)` (gate: `SITE_STAFF` —
   site_admin + PM tier; a physical store-custody action, so procurement stays
   read-only in the store, matching เบิก/count, spec 197; membership
   `can_see_project`; guards:
   `delivered`, `work_package_id IS NOT NULL`, `catalog_item_id IS NOT NULL`, not
   already diverted — the `stock_receipts_pr_uniq` index is the hard guard). It:
   1. **reverses the WP-bound purchase's posted GL entry directly** — finds the
      posted, non-reversed `purchase` journal entry and calls
      `reverse_journal_internal` (Dr 2100 AP / Cr 1400 WP-WIP); the cost leaves
      the WP synchronously;
   2. **skips any still-pending/posting `purchase` outbox job** (sets it `skipped`)
      so it can't post WP-WIP after the divert — if the purchase had not drained
      yet, no WP-WIP is ever posted and the receipt is the sole AP booking;
   3. inserts a `stock_receipts` row (all-in cost `amount/qty`, `purchase_request_id`
      stamped) + rolls `stock_on_hand` — the insert auto-enqueues its `stock_receipt`
      GL job (Dr 1500 / Cr AP on drain), exactly like spec 195 P3;
   4. sets the PR's **`work_package_id = NULL`** — it joins the store-bound
      population. `wp_profit`'s GL-materials term filters to WP-scoped `1400` lines
      and the store-sell term is disjoint (spec 178 U4), so no double-count once
      the WP-WIP entry is reversed.

**Why reverse directly, not via the purchase poster:** `post_purchase_to_gl` only
posts a PR in `purchased`/`site_purchased` — a _delivered_ PR raises `P0001`. So
the reversal cannot ride the purchase poster (an earlier re-enqueue design failed
exactly here, caught by pgTAP 216); the divert reverses **directly** + skips the
stale job. **`post_purchase_to_gl` is unchanged by this ADR.**

**Async timing converges:** purchase already posted → step 1 reverses it; still
pending → step 2 skips it (no WP-WIP ever). Both reach the same net.

**v1 scope:** divert the **whole** line only (no partial); the PR loses its WP
identity in the list (`work_package_id → NULL`) — the trace is preserved via
`stock_receipts.purchase_request_id`.

## Consequences

- A delivered WP-bound line can become store stock without double-counting; its
  cost lands on a WP only at เบิก, unifying with the store-bound model.
- `post_purchase_to_gl` is untouched; the divert owns its reversal, so the core
  purchase poster carries no spec-198 footprint.
- The diverted PR reads as project-level (WP-less) afterward; reports that key
  off `work_package_id` see the cost leave the WP (correct — it is now Inventory).
- Reversibility is bounded by the existing GL reversal engine; a wrongly-diverted
  line is corrected by reversing the receipt (spec 177 U11) — full undo of a
  divert (re-attaching the WP) is **out of scope** for v1.
