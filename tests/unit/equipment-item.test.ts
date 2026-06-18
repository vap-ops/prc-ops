// Spec 141 U1 — pure validation for the equipment-registry create/edit form.
// Thai, back-office-facing. The write path (RPC/policies) re-guards; this is
// shape/UX validation of the unit/bulk tracking invariants, not the security
// gate. Host-table-independent (no owner/category id checks here).

import { describe, it, expect } from "vitest";
import { validateEquipmentItem } from "@/lib/equipment/validate-equipment-item";

function input(over: Partial<Parameters<typeof validateEquipmentItem>[0]> = {}) {
  return {
    name: "เครื่องปั่นไฟ 5kVA",
    tracking: "unit",
    quantity: null as number | null,
    assetTag: "GEN-001",
    ...over,
  };
}

describe("validateEquipmentItem", () => {
  it("accepts a well-formed serialized (unit) item", () => {
    const r = validateEquipmentItem(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tracking).toBe("unit");
      expect(r.value.quantity).toBeNull();
      expect(r.value.assetTag).toBe("GEN-001");
    }
  });

  it("accepts a well-formed bulk item (quantity, no asset tag)", () => {
    const r = validateEquipmentItem(
      input({ name: "นั่งร้านโครง", tracking: "bulk", quantity: 200, assetTag: "" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tracking).toBe("bulk");
      expect(r.value.quantity).toBe(200);
      expect(r.value.assetTag).toBeNull();
    }
  });

  it("trims the name and nulls an empty asset tag", () => {
    const r = validateEquipmentItem(input({ name: "  รถตัก  ", assetTag: "   " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("รถตัก");
      expect(r.value.assetTag).toBeNull();
    }
  });

  it("rejects a blank name", () => {
    expect(validateEquipmentItem(input({ name: "   " })).ok).toBe(false);
  });

  it("rejects a name over 120 chars", () => {
    expect(validateEquipmentItem(input({ name: "ก".repeat(121) })).ok).toBe(false);
  });

  it("rejects an unknown tracking mode", () => {
    expect(validateEquipmentItem(input({ tracking: "serialized" })).ok).toBe(false);
  });

  it("rejects a unit item that carries a quantity", () => {
    expect(validateEquipmentItem(input({ tracking: "unit", quantity: 5 })).ok).toBe(false);
  });

  it("rejects a bulk item with a missing, zero, negative, or non-integer quantity", () => {
    const bulk = (q: number | null) =>
      validateEquipmentItem(input({ tracking: "bulk", quantity: q, assetTag: "" }));
    expect(bulk(null).ok).toBe(false);
    expect(bulk(0).ok).toBe(false);
    expect(bulk(-3).ok).toBe(false);
    expect(bulk(2.5).ok).toBe(false);
  });

  it("rejects an absurdly large bulk quantity", () => {
    expect(
      validateEquipmentItem(input({ tracking: "bulk", quantity: 1_000_001, assetTag: "" })).ok,
    ).toBe(false);
  });

  it("rejects a bulk item that carries an asset tag", () => {
    expect(
      validateEquipmentItem(input({ tracking: "bulk", quantity: 10, assetTag: "TAG-1" })).ok,
    ).toBe(false);
  });

  it("rejects an asset tag over 80 chars", () => {
    expect(validateEquipmentItem(input({ assetTag: "x".repeat(81) })).ok).toBe(false);
  });
});
