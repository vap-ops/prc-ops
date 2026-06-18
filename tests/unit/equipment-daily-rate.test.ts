// Spec 146 U1 §Tests (TDD, RED first) — pure validation for the per-item
// equipment daily-rate input. MONEY: this is the UI gate before the
// set_equipment_daily_rate RPC (pm/super/procurement). The RPC + DB CHECK
// (daily_rate is null or >= 0) re-guard; this layer gives fast, friendly Thai
// errors. A rate SET is a non-negative number — null/blank is rejected here
// (clearing a rate is not a U1 use case; mirrors set_worker_day_rate).

import { describe, it, expect } from "vitest";
import { validateEquipmentDailyRate } from "@/lib/equipment/validate-equipment-daily-rate";

describe("validateEquipmentDailyRate", () => {
  it("accepts a positive rate", () => {
    const r = validateEquipmentDailyRate(1500);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1500);
  });

  it("accepts zero (a free-of-charge item is valid)", () => {
    const r = validateEquipmentDailyRate(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it("rejects null (a rate is required to set one)", () => {
    expect(validateEquipmentDailyRate(null).ok).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateEquipmentDailyRate(undefined).ok).toBe(false);
  });

  it("rejects a negative rate", () => {
    const r = validateEquipmentDailyRate(-1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ติดลบ");
  });

  it("rejects NaN / non-finite", () => {
    expect(validateEquipmentDailyRate(Number.NaN).ok).toBe(false);
    expect(validateEquipmentDailyRate(Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});
