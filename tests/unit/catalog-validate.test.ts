// Spec 214 — product-code format: empty (unset) or exactly six ASCII digits.
import { describe, expect, it } from "vitest";
import { isValidProductCode } from "@/lib/catalog/validate";

describe("isValidProductCode (spec 214)", () => {
  it("accepts an empty / blank code (unset)", () => {
    expect(isValidProductCode("")).toBe(true);
    expect(isValidProductCode("   ")).toBe(true);
  });

  it("accepts exactly six digits", () => {
    expect(isValidProductCode("010120")).toBe(true);
    expect(isValidProductCode("000000")).toBe(true);
    expect(isValidProductCode("999999")).toBe(true);
  });

  it("rejects anything that is not six digits", () => {
    expect(isValidProductCode("12345")).toBe(false); // 5
    expect(isValidProductCode("1234567")).toBe(false); // 7
    expect(isValidProductCode("12AB56")).toBe(false); // letters
    expect(isValidProductCode("01-01-20")).toBe(false); // punctuation
    expect(isValidProductCode("๐๑๐๑๒๐")).toBe(false); // Thai digits are not ASCII
  });
});
