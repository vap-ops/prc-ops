// Spec 116 / ADR 0044 — pure validation for the create-PO form. The
// create_purchase_order RPC re-checks everything server-side (approved-only
// lines, supplier exists, atomic); this layer is the fast, friendly pre-check.

import { describe, expect, it } from "vitest";
import { validateCreatePurchaseOrder } from "@/lib/purchasing/validate-create-purchase-order";

const SUP = "11111111-1111-4111-8111-111111111111";
const R1 = "aaaaaaaa-1111-4111-8111-111111111111";
const R2 = "bbbbbbbb-2222-4222-8222-222222222222";

describe("validateCreatePurchaseOrder", () => {
  it("accepts a valid multi-line bundle (priced + unpriced lines)", () => {
    const r = validateCreatePurchaseOrder({
      supplierId: SUP,
      eta: "2026-07-15",
      lines: [
        { requestId: R1, amount: 100 },
        { requestId: R2, amount: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        supplierId: SUP,
        eta: "2026-07-15",
        lines: [
          { requestId: R1, amount: 100 },
          { requestId: R2, amount: null },
        ],
      });
    }
  });

  it("rejects an empty line set", () => {
    const r = validateCreatePurchaseOrder({ supplierId: SUP, eta: null, lines: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects a missing / invalid supplier", () => {
    const r = validateCreatePurchaseOrder({
      supplierId: "not-a-uuid",
      eta: null,
      lines: [{ requestId: R1, amount: 100 }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid request id", () => {
    const r = validateCreatePurchaseOrder({
      supplierId: SUP,
      eta: null,
      lines: [{ requestId: "bad", amount: 100 }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-positive or non-finite amount", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = validateCreatePurchaseOrder({
        supplierId: SUP,
        eta: null,
        lines: [{ requestId: R1, amount: bad }],
      });
      expect(r.ok).toBe(false);
    }
  });

  it("accepts a null amount (unpriced line)", () => {
    const r = validateCreatePurchaseOrder({
      supplierId: SUP,
      eta: "2026-07-15",
      lines: [{ requestId: R1, amount: null }],
    });
    expect(r.ok).toBe(true);
  });

  it("requires a valid eta (rejects null, empty, and bad format)", () => {
    for (const bad of [null, "", "   ", "15/07/2026"]) {
      const r = validateCreatePurchaseOrder({
        supplierId: SUP,
        eta: bad,
        lines: [{ requestId: R1, amount: 100 }],
      });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a bundle with duplicate request ids", () => {
    const r = validateCreatePurchaseOrder({
      supplierId: SUP,
      eta: null,
      lines: [
        { requestId: R1, amount: 100 },
        { requestId: R1, amount: 200 },
      ],
    });
    expect(r.ok).toBe(false);
  });
});
