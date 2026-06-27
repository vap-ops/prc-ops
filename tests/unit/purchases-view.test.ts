// Writing failing test first.
//
// Spec 196 Tier 3 — the purchase register + voucher for accounting audit.
// purchases-view.ts is the pure layer: status labels, a register summary
// (count + gross/VAT/net totals derived from each PR's gross + vat_rate), and the
// attachment-purpose policy. Price/quote evidence stays procurement-only (the
// operator's call), so a 'quote' attachment is NOT auditable here.

import { describe, expect, it } from "vitest";

import {
  summarizePurchases,
  isAuditableAttachmentPurpose,
  attachmentPurposeLabel,
  purchaseRegisterCountLabel,
} from "@/lib/accounting/purchases-view";

describe("summarizePurchases", () => {
  it("counts and totals gross, deriving net/VAT from each row's rate", () => {
    const s = summarizePurchases([
      { gross: 107, vatRate: 7 }, // net 100, vat 7
      { gross: 50, vatRate: 0 }, // net 50, vat 0
    ]);
    expect(s.count).toBe(2);
    expect(s.totalGross).toBe(157);
    expect(s.totalVat).toBe(7);
    expect(s.totalNet).toBe(150);
  });

  it("is zero for no purchases", () => {
    expect(summarizePurchases([])).toEqual({
      count: 0,
      totalGross: 0,
      totalVat: 0,
      totalNet: 0,
    });
  });
});

describe("purchaseRegisterCountLabel (spec 211 U9 — accounting-ap-02)", () => {
  it("counts register rows as ใบขอซื้อ, not the overloaded รายการ", () => {
    expect(purchaseRegisterCountLabel(3)).toBe("3 ใบขอซื้อ");
    expect(purchaseRegisterCountLabel(0)).toBe("0 ใบขอซื้อ");
  });
});

describe("attachment purpose policy", () => {
  it("excludes quote evidence (price stays procurement-only)", () => {
    expect(isAuditableAttachmentPurpose("quote")).toBe(false);
  });

  it("admits reference, invoice, delivery, and payment evidence", () => {
    for (const p of ["reference", "invoice", "delivery_confirmation", "payment"]) {
      expect(isAuditableAttachmentPurpose(p)).toBe(true);
    }
  });

  it("labels payment and invoice purposes in Thai", () => {
    expect(attachmentPurposeLabel("payment")).toBe("หลักฐานการชำระเงิน");
    expect(attachmentPurposeLabel("invoice")).toBe("ใบแจ้งหนี้/ใบกำกับภาษี");
  });

  it("falls back to the raw purpose for an unknown kind", () => {
    expect(attachmentPurposeLabel("future_kind")).toBe("future_kind");
  });
});
