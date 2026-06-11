import { describe, expect, it } from "vitest";
import { validateRecordPurchase } from "@/lib/purchasing/validate-record-purchase";
import { isBackOfficeRole } from "@/lib/purchasing/back-office";

const REQUEST_ID = "a1000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "51000000-0000-4000-8000-000000000001";

describe("validateRecordPurchase", () => {
  it("accepts a full valid input and trims the order ref", () => {
    expect(
      validateRecordPurchase({
        requestId: REQUEST_ID,
        supplierId: SUPPLIER_ID,
        orderRef: "  PO-2026-042  ",
        amount: 12500.5,
        eta: "2026-06-20",
      }),
    ).toEqual({
      ok: true,
      value: {
        requestId: REQUEST_ID,
        supplierId: SUPPLIER_ID,
        orderRef: "PO-2026-042",
        amount: 12500.5,
        eta: "2026-06-20",
      },
    });
  });

  it("accepts the minimal input — optional fields become null", () => {
    expect(
      validateRecordPurchase({
        requestId: REQUEST_ID,
        supplierId: SUPPLIER_ID,
        orderRef: "",
        amount: null,
        eta: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        requestId: REQUEST_ID,
        supplierId: SUPPLIER_ID,
        orderRef: null,
        amount: null,
        eta: null,
      },
    });
  });

  it("rejects malformed ids", () => {
    expect(
      validateRecordPurchase({
        requestId: "nope",
        supplierId: SUPPLIER_ID,
        orderRef: "",
        amount: null,
        eta: null,
      }).ok,
    ).toBe(false);
    expect(
      validateRecordPurchase({
        requestId: REQUEST_ID,
        supplierId: "nope",
        orderRef: "",
        amount: null,
        eta: null,
      }).ok,
    ).toBe(false);
  });

  it("rejects a non-positive or non-finite amount", () => {
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        validateRecordPurchase({
          requestId: REQUEST_ID,
          supplierId: SUPPLIER_ID,
          orderRef: "",
          amount,
          eta: null,
        }).ok,
      ).toBe(false);
    }
  });

  it("rejects an over-long order ref", () => {
    expect(
      validateRecordPurchase({
        requestId: REQUEST_ID,
        supplierId: SUPPLIER_ID,
        orderRef: "x".repeat(81),
        amount: null,
        eta: null,
      }).ok,
    ).toBe(false);
  });

  it("rejects a malformed eta", () => {
    for (const eta of ["20-06-2026", "2026/06/20", "tomorrow"]) {
      expect(
        validateRecordPurchase({
          requestId: REQUEST_ID,
          supplierId: SUPPLIER_ID,
          orderRef: "",
          amount: null,
          eta,
        }).ok,
      ).toBe(false);
    }
  });
});

describe("isBackOfficeRole", () => {
  it("admits exactly the ADR 0038 gate", () => {
    expect(isBackOfficeRole("project_manager")).toBe(true);
    expect(isBackOfficeRole("procurement")).toBe(true);
    expect(isBackOfficeRole("super_admin")).toBe(true);
    expect(isBackOfficeRole("site_admin")).toBe(false);
    expect(isBackOfficeRole("visitor")).toBe(false);
  });
});
