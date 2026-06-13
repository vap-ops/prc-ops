// Spec 66 — pure validation for the on-site purchase form. The
// record_site_purchase RPC re-checks everything server-side; this layer
// gives fast, friendly Thai errors. Mirrors validate-record-purchase.
import { describe, expect, it } from "vitest";

import { validateSitePurchase } from "@/lib/purchasing/validate-site-purchase";

const WP = "123e4567-e89b-12d3-a456-426614174000";

function base() {
  return { workPackageId: WP, itemDescription: "ปูนถุง 50 กก.", quantity: 10, unit: "ถุง" };
}

describe("validateSitePurchase", () => {
  it("accepts a well-formed on-site purchase and trims text", () => {
    const r = validateSitePurchase({ ...base(), itemDescription: "  ทราย  ", unit: " คิว " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        workPackageId: WP,
        itemDescription: "ทราย",
        quantity: 10,
        unit: "คิว",
      });
    }
  });

  it("rejects a bad work-package id", () => {
    const r = validateSitePurchase({ ...base(), workPackageId: "not-a-uuid" });
    expect(r.ok).toBe(false);
  });

  it("rejects blank or whitespace-only item description", () => {
    expect(validateSitePurchase({ ...base(), itemDescription: "" }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), itemDescription: "   " }).ok).toBe(false);
  });

  it("rejects an item description over 500 characters", () => {
    expect(validateSitePurchase({ ...base(), itemDescription: "x".repeat(501) }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), itemDescription: "x".repeat(500) }).ok).toBe(true);
  });

  it("rejects blank or over-length unit", () => {
    expect(validateSitePurchase({ ...base(), unit: "" }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), unit: "x".repeat(41) }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), unit: "x".repeat(40) }).ok).toBe(true);
  });

  it("rejects non-positive or non-finite quantity", () => {
    expect(validateSitePurchase({ ...base(), quantity: 0 }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), quantity: -1 }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), quantity: Number.NaN }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), quantity: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });
});
