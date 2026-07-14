// Spec 317 U7 — the Thai-bank SSOT behind every ชื่อธนาคาร picker (operator
// 2026-07-14: selection not free text, sorted by usage frequency, with icons).
// Canonical short names keep stored bank_name values consistent across
// workers/contact_bank/staff_registration_bank; monogram color chips stand in
// for logos (self-contained, no trademark assets).

import { describe, expect, it } from "vitest";
import { THAI_BANKS, sortBanksByUsage, findBankByName } from "@/lib/banks/thai-banks";

describe("THAI_BANKS", () => {
  it("lists the major retail banks once each, market-share leaders first", () => {
    const names = THAI_BANKS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    // The big four lead the static order.
    expect(names.slice(0, 4)).toEqual(["กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย"]);
    expect(names).toContain("ออมสิน");
    expect(THAI_BANKS.length).toBeGreaterThanOrEqual(12);
  });

  it("every bank carries a monogram short name and a brand color", () => {
    for (const b of THAI_BANKS) {
      expect(b.shortName.length).toBeGreaterThan(0);
      expect(b.shortName.length).toBeLessThanOrEqual(4);
      expect(b.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("sortBanksByUsage", () => {
  it("orders by live usage count desc, then static rank", () => {
    const usage = new Map([
      ["ออมสิน", 5],
      ["กรุงไทย", 5],
      ["ทหารไทยธนชาต", 9],
    ]);
    const sorted = sortBanksByUsage(usage).map((b) => b.name);
    expect(sorted[0]).toBe("ทหารไทยธนชาต");
    // Tie at 5 → static (market-share) order breaks it: กรุงไทย before ออมสิน.
    expect(sorted[1]).toBe("กรุงไทย");
    expect(sorted[2]).toBe("ออมสิน");
    // Unused banks follow in static order.
    expect(sorted[3]).toBe("กสิกรไทย");
  });

  it("returns the static order when no usage exists", () => {
    expect(sortBanksByUsage(new Map()).map((b) => b.name)).toEqual(THAI_BANKS.map((b) => b.name));
  });
});

describe("findBankByName", () => {
  it("resolves a canonical name and returns null for free-text strangers", () => {
    expect(findBankByName("กสิกรไทย")?.shortName).toBeTruthy();
    expect(findBankByName("ธนาคารในจินตนาการ")).toBeNull();
  });
});
