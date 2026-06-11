// Pins for the unit-picker vocabulary (spec 16 §1). The exact list is
// the operator's site vocabulary — amendable by code PR; this pin makes
// any change deliberate. The sentinel must never appear in the list
// (it is UI state, never persisted).

import { describe, expect, it } from "vitest";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";

const EXPECTED = [
  "ถุง",
  "กระสอบ",
  "ก้อน",
  "แผ่น",
  "เส้น",
  "ท่อน",
  "ม้วน",
  "มัด",
  "กล่อง",
  "ชุด",
  "ตัว",
  "อัน",
  "ชิ้น",
  "ใบ",
  "ถัง",
  "แกลลอน",
  "กระป๋อง",
  "เมตร",
  "ตารางเมตร",
  "ลูกบาศก์เมตร",
  "คิว",
  "กิโลกรัม",
  "ตัน",
  "ลิตร",
  "เที่ยว",
];

describe("COMMON_UNITS", () => {
  it("pins the exact 25-entry list and order", () => {
    expect([...COMMON_UNITS]).toEqual(EXPECTED);
  });

  it("has no duplicates, blanks, or untrimmed entries, all within the 50-char form limit", () => {
    expect(new Set(COMMON_UNITS).size).toBe(COMMON_UNITS.length);
    for (const u of COMMON_UNITS) {
      expect(u.trim()).toBe(u);
      expect(u.length).toBeGreaterThan(0);
      expect(u.length).toBeLessThanOrEqual(50);
    }
  });

  it("does not contain the free-text sentinel", () => {
    expect(COMMON_UNITS).not.toContain(UNIT_OTHER_VALUE);
    expect(UNIT_OTHER_VALUE).toBe("__other__");
  });
});
