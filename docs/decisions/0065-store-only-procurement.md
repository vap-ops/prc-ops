# ADR 0065 — Store-only procurement: every purchase routes through the store; a WP's material cost lands at เบิก (supersedes the two-path model of ADR 0063/0022; spec 208 Phase 2)

## Status

Accepted (2026-06-26). Operator decision (AskUserQuestion, this session) lifting
the **spec 208 Phase 2 deferral** of 2026-06-24/26. Triggered by in-app feedback
`e4c02550-f78b-4e21-9c9e-d9b8f7beb426` (a **procurement** user): _"Accepting items
from delivery should always go to the store. Put them in the respected store, and
change the workflow."_

Supersedes the WP-bound purchase-posting branch of **ADR 0022** / **ADR 0063** for
**new** purchases; **ADR 0064** (divert) becomes the cutover mechanism (U5), not an
ongoing operator action. Implemented by spec 208 Phase 2 (U4a/U4b/U5) + the U6 Q3
micro-unit.

## Context

ADR 0063 + spec 195 P3 made purchasing project-aware and created **two purchase
paths** that coexist:

- **WP-bound** PR → `post_purchase_to_gl` books **Dr 1400 WP-WIP / Cr 2100 AP** at
  `purchased`; the material is delivered straight to the WP. No store record.
- **WP-less** (whole-project) PR → the purchase posting is suppressed; the
  **receipt** books **Dr 1500 Inventory / Cr 2100 AP**; a later เบิก moves it
  **Dr 1400 WP-WIP / Cr 1500 Inventory** (spec 177/178), so the WP's material cost
  lands once, at usage.

Spec 208 Phase 2 designed the unification (store-only) but the operator **deferred**
it (design pass 3, 2026-06-26), keeping both paths plus the U3b cash shortcut, behind
a hard sign-off gate requiring this ADR and four product/accounting decisions.

The two-path model is the root of the procurement user's report: a delivery against a
**WP-bound** PO does not appear in the store, and that user cannot confirm arrival.
The operator chose to lift the deferral and enforce store-only.

## Decision

**Every purchase routes through the store. A WP consumes material only via เบิก, so a
WP's material cost lands exactly once, at usage — as the transfer (sell-price) layer.**
The WP-bound purchase-posting branch is retired for new purchases; nothing books
Dr 1400 at purchase any longer.

```
purchase (PR → purchased) : nothing posts
receive (→ delivered)     : Dr 1500 Inventory (net) / Dr 1300 Input VAT / Cr 2100 AP (gross)
เบิก    (issue → WP)       : Dr 1400 WP-WIP / Cr 1500 Inventory  (at the transfer sell-price, spec 178)
```

The four gate decisions (this session), each resolving a precondition the spec marked
a blocker:

1. **`stockable=false` items route through the store too (the flag goes dead).**
   The 17/71 deliberately-non-inventoried, direct-to-WP catalog items (fire doors,
   cut-to-length roofing, septic tanks, custom fabrication) are **no exception**:
   under store-only they take a transient store hop (receipt → เบิก) like any other
   item. `catalog_items.stockable` becomes informational; it no longer gates a
   purchase path. (Operator chose universality over a carve-out — one model, no
   silent direct-to-WP cost path to maintain.)

2. **Force-catalog at PR entry.** Every purchase PR must reference a catalog item
   (`catalog_item_id IS NOT NULL`); a genuinely new item is added to the catalog
   first. This closes the off-catalog cost-vanish hole (an off-catalog PR under
   store-only would book nothing). Off-catalog / walk-in is **not** a separate store
   path. Friction (a one-off buy needs a quick catalog entry) is accepted.

3. **`wp_profit` materials = the sell-price transfer layer, app-wide.** With all
   material flowing store → เบิก, a WP's material cost is the `stock_issues`-sourced
   transfer (sell price), **not** purchase cost. This is the intended self-governance
   behaviour ([[wp-profit-sharing-ht-model]] / ADR 0060). The purchase-sourced 1400
   term goes to **zero** for all new WPs. A WP open across the cutover carries
   **mixed-basis** material cost (purchase-cost before, sell-price after) — accepted
   and documented; freeze the cutover at a project boundary where practical.

4. **Procurement may confirm physical arrival (รับของ).** The site-staff-only
   `canReceive` gate is relaxed to admit procurement, reversing spec 134 U8's
   "receiving is a site action." This is the literal ask in the report. It is a
   role-doctrine change touching `src/lib/auth` and ships as its own gated micro-unit
   (spec 208 U6 / Q3).

**Input VAT is a correctness requirement, not a dial.** Under store-only, a
VAT-registered purchase that today books reclaimable Input VAT to 1300 must still do
so — at **receipt**: **Dr 1500 net / Dr 1300 Input VAT / Cr 2100 gross** when the
originating PR has `vat_rate > 0`. The existing receipt poster is VAT-agnostic (books
all-in gross to 1500); leaving it so would bury Input VAT in Inventory → VAT
overstated/overpaid, silently (reconciliation stays green). U4b splits VAT at receipt.

**Cutover & legacy data (U5) is the only irreversible step and stays operator-signed.**
In-flight WP-bound PRs already posted to WIP must not double-count when the universal
receipt fires. They are reconciled with **ADR 0064's `divert_purchase_to_store`**
(reverse WP-WIP + book Inventory, net WP-WIP → 0), after first **draining all
pending/failed `purchase` outbox jobs under the old gate** (the ฿102k drain-outage
history means some may not have posted). Cohort already delivered + WIP-posted is left
historical, with its outbox rows quiesced so the spec-203-widened gate cannot
re-enqueue them. The backfill sets `work_package_id = NULL` (one-way; trace preserved
via `stock_receipts.purchase_request_id` + `audit_log`), so it runs under the
`break-glass.md` floor (verified `pg_dump` + preview-branch rehearsal) with the
operator owning the merge, the cutover date, and the `db push`.

## Consequences

- **One purchase model.** "Where did the delivery go?" always has the same answer: the
  store. The store is the single inventory + cost-entry point; เบิก is the single WP
  cost event. The procurement user's report is resolved.
- **`stockable` is dead as a path selector.** Non-inventoried items now carry an
  on-hand balance between receipt and เบิก. Project-close residual inventory (Gap 6)
  grows; disposition (write-off/transfer/carry) is a named follow-up.
- **Materials valuation flips to sell-basis** for all new WPs; profit reports change
  meaning at the cutover. pgTAP must assert a formerly-WP-bound purchase produces
  **zero** 1400-purchase lines and its cost lands via the issue leg.
- **VAT is split at receipt**, preserving the Input VAT 1300 reclaim that the
  store-receipt path previously dropped.
- **ADR 0063's WP-less/WP-bound split and ADR 0022's purchase-time WIP posting are
  superseded for new purchases;** the function bodies are kept (legacy rows +
  reversibility), but no new row routes to the WIP-at-purchase arm.
- **ADR 0064 (divert)** is retained as the U5 cutover tool; once cutover completes,
  there are no new WP-bound deliveries to divert, so it becomes dormant (kept for
  correcting any stragglers).
- **Dashboard `sumMaterials`** must exclude store-bound PRs or it double-counts
  (purchase amount + store-issue) — folded into U4b, not deferred.
- **Out of scope (named follow-ups):** returns-to-supplier credit notes (must reverse
  1500 net + 1300 VAT + 2100 gross), bulk reversal UI, store-to-store transfer, and
  project-close residual-inventory disposition.
