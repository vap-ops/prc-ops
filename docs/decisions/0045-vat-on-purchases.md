# ADR 0045 — VAT capture on purchases

- Status: Accepted (2026-06-16)
- Context: `purchase_requests.amount` was a single, ambiguous number (net? gross?).
  The operator wants VAT handling — specifically: when recording a price, the
  **user picks whether it is VAT-inclusive or VAT-exclusive**, and the system
  shows the net / VAT / gross breakdown. Thai standard VAT is 7%. Suppliers
  already carry a tax id (spec 84); invoice/receipt docs already exist (spec 66).
  The `accounting` role is v3, so full tax _reporting_ is out of scope.

## Decisions

1. **`amount` is canonically the GROSS** (total incl VAT = what you pay). Spend,
   budget, PO total, and per-supplier spend keep reading `amount` unchanged
   (operator decision: spend = cash out). Legacy rows are gross with no VAT.

2. **New column `purchase_requests.vat_rate`** (`numeric(5,2)`, default 0; 0 = no
   VAT recorded). It records the rate applied; **net and VAT are DERIVED**, never
   stored (`src/lib/purchasing/vat.ts` `deriveVatBreakdown` — `net = gross/(1+r)`,
   `vat = gross − net`; net + VAT always sum back to the gross). No redundant
   columns, no drift.

3. **Entry is a mode, storage is gross + rate.** The form offers `inclusive`
   (the typed price already includes VAT), `exclusive` (typed = net → add VAT to
   get the stored gross), `none` (no VAT, rate 0). `grossFromEntry` resolves the
   gross; `rateForMode` the stored rate. The mode itself is not stored (it is an
   entry convenience; gross + rate capture the fact).

4. **The three amount-entry RPCs each gain `p_vat_rate`** (default 0 → existing
   callers / tests / appsheet unaffected): `record_purchase`,
   `create_purchase_order`, `record_site_purchase`. A PO carries **one rate**
   (one supplier). `vat_rate` follows `amount`'s money posture: written ONLY by
   the RPCs (not in the authenticated column UPDATE grant); table-level SELECT
   covers reads, gated to procurement/admin at the app layer (never site_admin).

## Why not the alternatives

- **Store net + VAT + gross columns**: redundant, and rounding drift must be kept
  consistent across three columns. Derived-from-gross+rate is the single source.
- **`amount` = net (accountant view, VAT reclaimable)**: ripples through every
  spend/budget view and conflates with input-VAT accounting (a v3 concern).
  Rejected for v1 — spend = gross is the operator's mental model.
- **Withholding tax / tax-invoice docs / VAT reports**: deferred (the v3
  accounting role); this ADR is purchase-VAT capture only.

## Consequences

One column + one helper + the 3 RPCs gaining a rate param. Phased UI (spec 119):
the **PO checkout** captures VAT first (the active flow, live breakdown);
`record_purchase` + `record_site_purchase` form pickers and a persistent net/VAT
readout on the detail page / drawer are additive follow-ups (RPCs already accept
the rate — no further schema). Migration applies under the operator gate.
