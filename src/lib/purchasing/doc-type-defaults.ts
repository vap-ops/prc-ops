// Spec 380 U5 — per-mount doc_type defaulting. `InvoiceUploader` mounts at
// several sites with genuinely different correct answers; centralising the
// rule here (rather than inlining a ternary per page) keeps the ONE hard
// constraint checkable in one place: never pre-select a type that makes the
// order's coverage WORSE than leaving it untyped. delivery_note sits in
// NEVER_SATISFYING — pre-selecting it on the receive card would flip an
// order that reads covered_loose today (untyped `invoice` purpose) into
// missing on the very upload meant to document it. So that mount gets no
// default at all; the other mounts split on their PARENT status, which is
// always known and never ambiguous the way "what did the driver hand over"
// is.

import type { PurchaseDocType } from "@/lib/purchasing/doc-chase";
import type { PurchaseRequestStatus } from "@/lib/purchasing/doc-chase";

export function defaultInvoiceDocType(status: PurchaseRequestStatus): PurchaseDocType | null {
  switch (status) {
    case "purchased":
      return "tax_invoice_full";
    // Fresh-eyes: this default is class-blind and safe only because
    // record_site_purchase never stamps supplier_id, so every site_purchased
    // row classes 'unknown' -> the full ladder -> receipt_cash_bill always
    // satisfies. If a future change ever attaches a VAT-registered supplier
    // to a site_purchased row, this default would silently flip a covered
    // order to missing. Re-check that invariant before touching either side.
    case "site_purchased":
      return "receipt_cash_bill";
    default:
      return null;
  }
}

/**
 * The self-purchase form already computes a VAT split server-side when
 * vatRate > 0 (`record_site_purchase`) — that split needs a full tax invoice
 * behind it, not a cash bill, so the inference follows the same field the
 * form already collects rather than asking a second question.
 */
export function inferSelfPurchaseDocType(vatRate: number | null): PurchaseDocType {
  return vatRate !== null && vatRate > 0 ? "tax_invoice_full" : "receipt_cash_bill";
}
