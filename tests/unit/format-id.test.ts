import { describe, expect, it } from "vitest";
import { formatPoNumber, formatPrNumber } from "@/lib/purchasing/format-id";

// Spec 211 U2 — one home for rendering the human PO / PR running numbers, so the
// same id never renders two ways (the grid showed bare "PR-7" while the drawer
// showed "PR-0007"). Mirrors the zero-pad already used by compose-notification.
describe("formatPoNumber / formatPrNumber (spec 211 U2)", () => {
  it("zero-pads to 4 digits with the typed prefix", () => {
    expect(formatPrNumber(7)).toBe("PR-0007");
    expect(formatPrNumber(1)).toBe("PR-0001");
    expect(formatPoNumber(12)).toBe("PO-0012");
  });

  it("does not truncate numbers wider than 4 digits", () => {
    expect(formatPoNumber(12345)).toBe("PO-12345");
    expect(formatPrNumber(99999)).toBe("PR-99999");
  });

  it("treats null/undefined as 0 (matches the notification formatter)", () => {
    expect(formatPrNumber(null)).toBe("PR-0000");
    expect(formatPoNumber(undefined)).toBe("PO-0000");
  });
});
