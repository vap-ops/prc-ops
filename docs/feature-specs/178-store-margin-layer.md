# Spec 178 — Store margin layer (transfer pricing)

**Status:** in progress (2026-06-22). Phase 7 of the on-site storage / inventory arc — the
**margin layer**, the payoff of "store = a business unit". The store SELLS stock to a work
package at a per-item **sell price** (not cost); the WP's material cost becomes the at-issue
sell price; **Store P&L = Σ(sell − cost) − shrinkage**.

**Predecessors:** spec 175 (catalog), spec 176 (supply plan), spec 177 (store cost-side:
receive → hold at moving-avg → issue → custody → count/variance → reversals). See memory
`storage-unit-inventory-bu`. Builds on spec 161 (`wp_profit`, the profit engine).

## Operator decisions (AskUserQuestion, 2026-06-22)

1. **Sell-price model = flat per-item rate.** One global sell rate per `catalog_item_id`
   (not markup %, not per-project). Confirms the long-standing dial ("per-item sell rate,
   not markup%"). Money-posture: margin-sensitive → zero authenticated grant (the
   `sell_rate_table` / day-rate posture), set by super_admin, read via the admin client.
2. **Capture point = at issue (เบิก).** `issue_stock` snapshots a `sell_price` beside the
   moving-average `unit_cost` it already records, the moment stock is drawn to the WP. The
   WP's material cost is known immediately; mirrors the moving-avg-at-issue pattern.
3. **`wp_profit` material cost = ADD store-sell beside GL purchases.** `wp_profit`'s
   material line today = GL acct 1400, `purchase_requests`-sourced only. Store issues are
   NOT in the GL → a disjoint source. Fold the per-WP store-issue SELL total INTO the
   materials line (no return-signature change). No double-count; a WP pays the sell price
   for store stock AND the purchase price for direct-to-WP buys.
4. **External / 3rd-party sales = deferred.** This phase is internal store→WP transfer
   pricing only. External sales (real revenue + VAT + AR + a customer entity) are a later
   arc.

## Costing rule (when an item has no sell rate set)

`sell_price` snapshot at issue = **`coalesce(item_sell_rate, moving-avg unit_cost)`**. An
unpriced item sells at cost (zero store margin) — never at 0/NULL — so `wp_profit` is never
understated and Store P&L margin for an unpriced item is exactly 0. Setting a rate only
affects FUTURE issues (the snapshot is immutable, append-only).

## Reversed issues

A reversed issue (a `stock_reversals` row with `issue_id = <issue>`) must NOT charge the WP
and must NOT count toward Store P&L. Every sell/margin aggregate anti-joins
`stock_reversals` on `issue_id`.

## Units

- **U1 — sell-rate data + setter (DB-only).** `item_sell_rates` (PK `catalog_item_id`,
  `sell_rate numeric(12,2) >= 0`, zero authenticated grant, RLS enabled) +
  `set_item_sell_rate(p_catalog_item_id, p_sell_rate)` (super_admin gate, upsert, audit
  row, anon revoked). Mirrors `set_sell_rate` (spec 161 U1). mig `20260809000600`, pgTAP 186. **← this unit.**
- **U2 — issue snapshots sell.** `stock_issues` += `sell_price numeric(12,2)` +
  `total_sell numeric(16,2)` generated `qty * sell_price`; `issue_stock` CREATE OR REPLACE
  (same 6-arg sig) computes `sell_price = coalesce(rate, v_avg)` and inserts it. mig
  `20260809000700`, pgTAP 187.
- **U3 — Store P&L read.** `store_pnl(p_project_id)` per-item rows (qty issued, cost total,
  sell total, margin, shrinkage from `stock_counts.variance_value`), reversed issues
  excluded. Money gate (super/director), read via admin client. mig `20260809000800`,
  pgTAP 188.
- **U4 — flip `wp_profit`.** CREATE OR REPLACE `wp_profit` to fold the per-WP store-issue
  SELL total (non-reversed) into `v_materials`. Same return signature → grants + the
  90/91 pins hold; `settle_project` banks the new profit automatically. mig
  `20260809000900`, pgTAP 189.
- **U5 — sell-rate setter UI.** Per-item sell-rate control (super_admin only, rates read
  via admin client). Code-only.
- **U6 — store-margin UI.** Store P&L view on `/store` (per-item cost/sell/margin + project
  total + shrinkage), super/director gated. Code-only.

## Out of scope (flagged)

- External / 3rd-party sales (revenue + VAT + AR) — deferred (decision 4).
- Per-project sell-rate overrides — decision 1 chose global.
- GL posting of the store transfer (Dr WP-WIP / Cr store-revenue) — `wp_profit` reads the
  issue-sell directly; a GL leg is a later unit.
- Holding cost in Store P&L — only Σ(sell−cost) − shrinkage for now.

## Verification

Each DB unit: pgTAP (structure + happy path + costing-rule + deny branches) + `pnpm lint &&
typecheck && test`, `db:push`, `db:types`, `db:test`, `pnpm build`.
