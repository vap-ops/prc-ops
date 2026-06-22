// Spec 66 — pure validation for the on-site purchase form. The
// record_site_purchase RPC re-checks everything server-side; this layer
// gives fast, friendly Thai errors. Mirrors validate-record-purchase.
import { describe, expect, it } from "vitest";

import { validateSitePurchase } from "@/lib/purchasing/validate-site-purchase";

const WP = "123e4567-e89b-12d3-a456-426614174000";

function base() {
  return {
    workPackageId: WP,
    itemDescription: "ปูนถุง 50 กก.",
    quantity: 10,
    unit: "ถุง",
    amount: null as number | null,
    // Spec 176 U4: reactive-reason tag — required on the on-site path too.
    reasonCode: "unplanned_miss" as string | null,
  };
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
        amount: null,
        reasonCode: "unplanned_miss",
      });
    }
  });

  // Spec 103: optional purchase amount.
  it("accepts an optional positive amount and rejects non-positive/non-finite", () => {
    const ok = validateSitePurchase({ ...base(), amount: 1500 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.amount).toBe(1500);
    expect(validateSitePurchase({ ...base(), amount: null }).ok).toBe(true);
    expect(validateSitePurchase({ ...base(), amount: 0 }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), amount: -5 }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), amount: Number.NaN }).ok).toBe(false);
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

  // Spec 176 U4 — the reactive-reason tag is required on the on-site path.
  it("accepts each declared reason code and echoes it through", () => {
    for (const code of ["unplanned_miss", "rework", "breakage", "scope_change", "unforeseeable"]) {
      const r = validateSitePurchase({ ...base(), reasonCode: code });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.reasonCode).toBe(code);
    }
  });

  it("rejects an omitted, null, or unknown reason code", () => {
    expect(validateSitePurchase({ ...base(), reasonCode: null }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), reasonCode: "" }).ok).toBe(false);
    expect(validateSitePurchase({ ...base(), reasonCode: "because" }).ok).toBe(false);
  });
});
