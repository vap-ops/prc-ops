// Spec 380 U5 — per-mount doc_type defaulting. Pure, no IO, so the one rule
// that actually matters (never pre-select a type that REGRESSES coverage vs
// today's untyped covered-loose behaviour) is testable without a component.
import { describe, expect, it } from "vitest";

import {
  defaultInvoiceDocType,
  inferSelfPurchaseDocType,
} from "@/lib/purchasing/doc-type-defaults";

describe("defaultInvoiceDocType", () => {
  it("the receive card (delivered) gets NO default — a wrong pre-selection is worse than an empty one", () => {
    expect(defaultInvoiceDocType("delivered")).toBeNull();
  });

  it("purchased defaults to the vendor invoice (back-office ordered from a vendor)", () => {
    expect(defaultInvoiceDocType("purchased")).toBe("tax_invoice_full");
  });

  it("site_purchased defaults to the cash bill (SA cash buy)", () => {
    expect(defaultInvoiceDocType("site_purchased")).toBe("receipt_cash_bill");
  });

  it("on_route and every other status get no default (never asked here today)", () => {
    expect(defaultInvoiceDocType("on_route")).toBeNull();
    expect(defaultInvoiceDocType("requested")).toBeNull();
    expect(defaultInvoiceDocType("approved")).toBeNull();
    expect(defaultInvoiceDocType("rejected")).toBeNull();
    expect(defaultInvoiceDocType("cancelled")).toBeNull();
  });
});

describe("inferSelfPurchaseDocType", () => {
  it("a VAT-bearing purchase infers the full tax invoice (the VAT split needs a matching doc)", () => {
    expect(inferSelfPurchaseDocType(7)).toBe("tax_invoice_full");
    expect(inferSelfPurchaseDocType(0.01)).toBe("tax_invoice_full");
  });

  it("zero or no VAT infers the cash bill", () => {
    expect(inferSelfPurchaseDocType(0)).toBe("receipt_cash_bill");
    expect(inferSelfPurchaseDocType(null)).toBe("receipt_cash_bill");
  });
});
