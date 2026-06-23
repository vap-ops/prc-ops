# Spec 182 — Procurement price comparison (quotes + history)

Status: U1 + U2 + U3 + U4 SHIPPED to prod — 2026-06-23. ARC COMPLETE.
Builds on: spec 33/115/ADR 0038/0044 (suppliers + purchase orders), spec 179 (PR
links a catalog item — the price-history axis), spec 181 (the bulk PR that feeds
approved PRs to procurement).

## Why / operator (2026-06-23)

"How can we help procurement do price comparison better/easier? Do we even have
attachments?" Findings: attachments exist (quotation/invoice/photo on the PO +
PR), but **price comparison is entirely offline** — procurement gets quotes by
phone/email, picks one supplier in their head, and types one supplier + amount
into the PO. Losing quotes vanish; there's no side-by-side, no "what did we pay
last time."

## Decision (operator AskUserQuestion, 2026-06-23)

**Quotes + history.** Per approved PR, record multiple supplier quotes (supplier

- unit price + an attached doc), compare side-by-side (ranked, cheapest
  highlighted, +% vs cheapest), pick the winner → it prefills/creates the PO. PLUS
  a **last-paid benchmark** per catalog item (from spec-179's link). Losing quotes
  are kept (audit + future history). Not a full RFQ basket (a flagged bigger option).

## Money posture

`unit_price` is the sensitive field — more than PO existence. So the quote table
is **back-office-read only (project_manager / procurement / super_admin), NOT
site_admin**; writes go through SECURITY DEFINER RPCs (the suppliers/PO posture,
ADR 0038). The compare UI renders only for those roles on the PR detail screen.

## Unit arc

- **U1 — quote data + capture + compare table (this unit):** `purchase_quotes`
  (PR + supplier + unit_price + note) + `add_purchase_quote` / `remove_purchase_quote`
  RPCs (back-office gate; PR must be `approved`); the ranked compare table on
  `/requests/[requestId]` (cheapest highlighted, total = unit_price × qty, +% vs
  cheapest) + an add-quote form (supplier picker + unit price).
- **U2 — pick winner → PO:** choose a quote → prefills `create_purchase_order`
  (supplier + amount = unit_price × qty) so the winning price flows into the PO.
- **U3 — price-history benchmark (SHIPPED):** `item_price_history(catalog_item_id)`
  — recent NET unit prices from past purchased PRs of the same catalog item (the
  spec-179 link), newest first (limit 5) → the "เคยซื้อล่าสุด ฿X/หน่วย จาก Y · N
  ครั้ง" line above the table. NET = `amount/(1+vat_rate/100)/qty` (amount is the
  line GROSS, spec 119) so it's apples-to-apples with the net quotes. SECURITY
  DEFINER + back-office role gate (PM/procurement/super/director — site_admin +
  anon get nothing; the money posture). The page selects `catalog_item_id` and
  fetches the history only when `isBackOffice && approved && catalog_item_id`.
- **U4 — quote doc (SHIPPED):** a `quote` attachment purpose on pr-attachments +
  a nullable `quote_id` FK (→ purchase_quotes, ON DELETE CASCADE), so each quote
  carries its source quotation (the 📎). Attached PER ROW (cleaner + more robust
  than mid-add orchestration; matches "📎 per quote row"): a doc-less row shows an
  attach control (`QuoteDocAttach`, the InvoiceUploader pattern → pr-attachments
  bucket → `addQuoteAttachment` with purpose='quote' + quote_id); a doc'd row
  shows a link. **Money posture:** a RESTRICTIVE select gates quote rows to
  back-office (a quotation shows prices); the INSERT policy gains a quote arm
  (back-office, approved PR, quote on this PR — outer refs table-qualified to
  dodge the purchase_quotes.purchase_request_id name-capture). The storage upload
  policy widened (+procurement/director +approved). **Deletion edge:** a doc'd
  quote is append-only + FK-referenced, so it can't be hard-removed in normal ops
  (the cascade hits the append-only trigger) — the UI disables remove on a doc'd
  quote (kept for audit, aligned with "losing quotes are kept").

## U1 details

- `purchase_quotes`: `id`, `purchase_request_id` (FK, on delete cascade),
  `supplier_id` (FK suppliers), `unit_price numeric(12,2) >= 0`, `note`,
  `created_by`, `created_at`. **Unique (purchase_request_id, supplier_id)** — one
  current quote per supplier per PR (re-quote = remove + re-add). RLS: SELECT to
  the 3 back-office roles only; no write policy.
- `add_purchase_quote(pr, supplier, unit_price, note)`: gate PM/procurement/super;
  PR must exist + status `approved` (22023 otherwise); supplier must exist;
  unit_price >= 0; dup supplier → 23505. Returns the id.
- `remove_purchase_quote(quote_id)`: same gate; deletes (unknown → 22023).
- Action `addPurchaseQuote` / `removePurchaseQuote`; component `PriceComparison`
  on `/requests/[requestId]` (back-office render only), fed the PR's quotes +
  the suppliers list + the PR quantity.

### Verification (U1)

- pgTAP `192`: back-office adds 2 quotes + reads them; dup supplier → 23505;
  site_admin can neither read (RLS) nor add (42501); a non-approved PR → 22023;
  remove drops a quote; anon cannot execute.
- `PriceComparison` test: ranks by unit price (cheapest first/highlighted), total
  = price × qty, +% vs cheapest; add-quote calls `addPurchaseQuote`.
- `pnpm lint && typecheck && test`, then `db:push && db:types && db:test`, build.

## Out of scope (later units / follow-ups)

- The pick→PO wiring (U2), price history (U3), per-quote doc (U4).
- Full RFQ basket across many PRs (the bigger option the operator did not pick).
- Quote expiry / validity dates; supplier-side quote submission.
