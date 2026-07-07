// Writing failing test first.
//
// Spec 277 — the WP list shows the category LETTER in place of the meaningless
// "WP" in each code (display only; DB codes never change). E.g. งานระบบไฟฟ้า
// WP-12 → E-12. Codes without a "WP" prefix, or WPs with no category, are left
// untouched.

import { describe, expect, it } from "vitest";
import { formatWpCode } from "@/lib/work-packages/format-code";

describe("formatWpCode (spec 277)", () => {
  it("replaces the WP prefix with the category letter", () => {
    expect(formatWpCode("WP-12", "E")).toBe("E-12");
    expect(formatWpCode("WP-001", "W")).toBe("W-001");
  });

  it("normalises a dash-less WP prefix", () => {
    expect(formatWpCode("WP01", "S")).toBe("S-01");
  });

  it("is case-insensitive on the WP prefix", () => {
    expect(formatWpCode("wp-7", "X")).toBe("X-7");
  });

  it("leaves codes without a WP prefix unchanged", () => {
    expect(formatWpCode("SL-001", "E")).toBe("SL-001");
  });

  it("leaves the code unchanged when there is no category letter", () => {
    expect(formatWpCode("WP-12", null)).toBe("WP-12");
    expect(formatWpCode("WP-12", undefined)).toBe("WP-12");
    expect(formatWpCode("WP-12", "")).toBe("WP-12");
  });
});
