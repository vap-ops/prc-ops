// Pure validators behind the createPurchaseRequest / decidePurchaseRequest
// server actions (feature spec 09 / ADR 0022). The DB CHECK constraints are
// the security authority — these tests pin down the UX-side rules so the
// form can show inline errors before the round-trip. They must mirror the
// SQL CHECKs:
//   item_description / unit: length(trim(...)) > 0
//   quantity: > 0
//   decision_comment (when status = 'rejected'): non-null and non-blank

import { describe, it, expect } from "vitest";
import {
  validateCreatePurchaseRequest,
  isDecisionCommentValid,
  commentRequiredForDecision,
  isPurchaseDecision,
  PURCHASE_DECISIONS,
} from "@/lib/purchasing/validate-purchase-request";

const VALID_WP = "11111111-2222-3333-4444-555555555555";

describe("validateCreatePurchaseRequest", () => {
  it("accepts a typical valid input", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement bag 50kg",
      quantity: 10,
      unit: "bag",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        workPackageId: VALID_WP,
        itemDescription: "Cement bag 50kg",
        quantity: 10,
        unit: "bag",
      },
    });
  });

  it("trims leading and trailing whitespace on item_description and unit", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "   Cement   ",
      quantity: 1,
      unit: "  bag  ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.itemDescription).toBe("Cement");
      expect(r.value.unit).toBe("bag");
    }
  });

  it("preserves internal whitespace in item_description (only trims edges)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "  Cement   bag   50kg  ",
      quantity: 1,
      unit: "bag",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.itemDescription).toBe("Cement   bag   50kg");
  });

  it("rejects an empty item_description", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "",
      quantity: 1,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/item/i);
  });

  it("rejects whitespace-only item_description (mirrors length(trim(...)) > 0)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "   \t\n  ",
      quantity: 1,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/item/i);
  });

  it("rejects an empty unit", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unit/i);
  });

  it("rejects whitespace-only unit", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "   ",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unit/i);
  });

  it("rejects quantity = 0 (mirrors quantity > 0 CHECK)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 0,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quantity/i);
  });

  it("rejects negative quantity", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: -5,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quantity/i);
  });

  it("rejects NaN quantity", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: Number.NaN,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quantity/i);
  });

  it("rejects Infinity quantity", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: Number.POSITIVE_INFINITY,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quantity/i);
  });

  it("accepts fractional quantity (numeric column, not integer)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Sand",
      quantity: 0.5,
      unit: "tonne",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quantity).toBe(0.5);
  });

  it("rejects a malformed workPackageId", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: "not-a-uuid",
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/work package/i);
  });
});

describe("PURCHASE_DECISIONS", () => {
  it("contains exactly the two native decision values", () => {
    expect([...PURCHASE_DECISIONS]).toEqual(["approved", "rejected"]);
  });
});

describe("isPurchaseDecision", () => {
  it("accepts the two valid decisions", () => {
    expect(isPurchaseDecision("approved")).toBe(true);
    expect(isPurchaseDecision("rejected")).toBe(true);
  });

  it("rejects other lifecycle values (purchased / delivered are AppSheet-only)", () => {
    expect(isPurchaseDecision("purchased")).toBe(false);
    expect(isPurchaseDecision("delivered")).toBe(false);
    expect(isPurchaseDecision("requested")).toBe(false);
  });

  it("rejects junk inputs", () => {
    expect(isPurchaseDecision("")).toBe(false);
    expect(isPurchaseDecision(null)).toBe(false);
    expect(isPurchaseDecision(undefined)).toBe(false);
    expect(isPurchaseDecision(42)).toBe(false);
  });
});

describe("commentRequiredForDecision", () => {
  it("requires a comment only for rejected", () => {
    expect(commentRequiredForDecision("approved")).toBe(false);
    expect(commentRequiredForDecision("rejected")).toBe(true);
  });
});

describe("isDecisionCommentValid", () => {
  it("accepts any comment (including null/empty/whitespace) for approved", () => {
    expect(isDecisionCommentValid("approved", null)).toBe(true);
    expect(isDecisionCommentValid("approved", "")).toBe(true);
    expect(isDecisionCommentValid("approved", "   ")).toBe(true);
    expect(isDecisionCommentValid("approved", "looks good")).toBe(true);
  });

  it("rejects null/empty/whitespace comments for rejected", () => {
    expect(isDecisionCommentValid("rejected", null)).toBe(false);
    expect(isDecisionCommentValid("rejected", "")).toBe(false);
    expect(isDecisionCommentValid("rejected", "   ")).toBe(false);
    expect(isDecisionCommentValid("rejected", "\t\n  ")).toBe(false);
  });

  it("accepts real text for rejected", () => {
    expect(isDecisionCommentValid("rejected", "budget exceeded")).toBe(true);
  });
});
