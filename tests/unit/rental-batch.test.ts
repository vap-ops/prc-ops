// Spec 146 U1 §Tests (TDD, RED first) — pure validation for the inbound
// equipment_rental_batches header (PRC's monthly cost for a rented set).
// MONEY: the UI gate before create_equipment_rental_batch. Mirrors the DB
// CHECKs (monthly_rate >= 0; ends_on >= starts_on) so the form fails friendly.
// Dates are ISO YYYY-MM-DD strings compared lexicographically (= chronological);
// no Date parsing.

import { describe, it, expect } from "vitest";
import { validateRentalBatch } from "@/lib/equipment/validate-rental-batch";

function input(over: Partial<Parameters<typeof validateRentalBatch>[0]> = {}) {
  return {
    monthlyRate: 50000,
    startsOn: "2026-07-01",
    endsOn: null as string | null,
    ...over,
  };
}

describe("validateRentalBatch", () => {
  it("accepts an open-ended batch (no end date)", () => {
    const r = validateRentalBatch(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.monthlyRate).toBe(50000);
      expect(r.value.startsOn).toBe("2026-07-01");
      expect(r.value.endsOn).toBeNull();
    }
  });

  it("accepts a closed batch with ends_on >= starts_on", () => {
    const r = validateRentalBatch(input({ endsOn: "2026-12-31" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.endsOn).toBe("2026-12-31");
  });

  it("accepts ends_on equal to starts_on", () => {
    expect(validateRentalBatch(input({ endsOn: "2026-07-01" })).ok).toBe(true);
  });

  it("normalizes blank end date to null", () => {
    const r = validateRentalBatch(input({ endsOn: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.endsOn).toBeNull();
  });

  it("rejects a negative monthly rate", () => {
    const r = validateRentalBatch(input({ monthlyRate: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ติดลบ");
  });

  it("rejects a non-finite monthly rate", () => {
    expect(validateRentalBatch(input({ monthlyRate: Number.NaN })).ok).toBe(false);
  });

  it("rejects a missing start date", () => {
    expect(validateRentalBatch(input({ startsOn: "" })).ok).toBe(false);
  });

  it("rejects a malformed start date", () => {
    expect(validateRentalBatch(input({ startsOn: "07/01/2026" })).ok).toBe(false);
  });

  it("rejects ends_on before starts_on", () => {
    const r = validateRentalBatch(input({ startsOn: "2026-07-01", endsOn: "2026-06-30" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ก่อนวันเริ่ม");
  });

  it("rejects a malformed end date", () => {
    expect(validateRentalBatch(input({ endsOn: "2026-13-40" })).ok).toBe(false);
  });
});
