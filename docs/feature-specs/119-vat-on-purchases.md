# Spec 119 — VAT capture on purchases (phase 1)

**Status:** SHIPPED 2026-06-16 (migration `20260701000200` applied to prod; 874 unit / 1075 pgTAP / lint / typecheck / build green). PO-checkout path wired; other paths + readout = follow-ups. **ADR:** 0045.
**Driver:** operator — "user can pick whether the price is inclusive of VAT or exclusive." Spend = GROSS
(operator decision). Partial delivery was raised alongside and **declined** (across-ticket already works;
within-ticket split-quantity is not needed).

## What ships (phase 1)

- **Migration** (`20260701000200`): `purchase_requests.vat_rate numeric(5,2) default 0` + CHECK 0–100;
  the three amount-entry RPCs (`record_purchase`, `create_purchase_order`, `record_site_purchase`) each
  DROP+CREATE with `+p_vat_rate` (default 0), storing it. RPC-only-write (amount posture); no new grant.
- **Pure helper** `src/lib/purchasing/vat.ts` (TDD): `VAT_RATE=7`, `rateForMode`, `grossFromEntry`,
  `deriveVatBreakdown` (net + VAT sum back to gross).
- **PO checkout VAT** (`CreatePurchaseOrderSheet` + `createPurchaseOrder` action): a VAT mode picker
  (รวม / ก่อน / ไม่มี VAT); per-line entered prices resolve to the GROSS via the mode; one rate for the
  PO; a **live net / VAT / gross breakdown** on the total. The action passes `p_vat_rate`.
- **`database.types.ts`** hand-extended (vat_rate + the 3 RPC sigs), reconciled after `db:types`.
- **pgTAP** (file 49 +2): vat_rate column + `create_purchase_order` stores the rate; the 3 RPC
  signature pins updated (files 26/33/49 — the +numeric param).

## Scope

- **IN:** the column + helper + 3 RPCs accepting the rate + the **PO checkout** picker/breakdown + types
  - pgTAP. The capture + the structured-flow UI.
- **OUT (additive follow-ups — RPCs already ready, no schema):** the VAT picker on the `record_purchase`
  and `record_site_purchase` forms; a **persistent net/VAT readout** on the request detail page + the
  procurement grid/drawer. Also out (v3 accounting): withholding tax, tax-invoice (ใบกำกับภาษี) docs,
  VAT reports.

## Money posture

Unchanged. `amount` = gross (what you pay); `vat_rate` follows amount (RPC-write, procurement/admin-read,
never site_admin). `purchase_orders` still has no money column; the PO total is the computed gross.

## Acceptance (phase 1)

Procurement creates a PO, picks a VAT mode, enters prices → the sheet shows net/VAT/gross and the stored
amount is the gross; `vat_rate` is recorded; spend/budget/PO total read the gross unchanged. pgTAP green.
