// Spec 214 — product-code format: empty (unset) or exactly six ASCII digits.
// Spec 221 U4 — the code is COMPOSED from the taxonomy (category + subcategory
// codes) + a typed sequence tail.
import { describe, expect, it } from "vitest";
import {
  composeProductCode,
  isValidProductCode,
  productCodeTailLength,
} from "@/lib/catalog/validate";

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

describe("productCodeTailLength (spec 221 U4)", () => {
  it("is 4 when there is no subcategory (prefix = the 2-digit category code)", () => {
    expect(productCodeTailLength("06", "")).toBe(4);
  });

  it("is 2 when a subcategory is chosen (prefix = category + subcategory = 4 digits)", () => {
    expect(productCodeTailLength("06", "01")).toBe(2);
  });
});

describe("composeProductCode (spec 221 U4)", () => {
  it("composes category + subcategory + tail into the stored 6-digit code", () => {
    expect(composeProductCode("01", "02", "50")).toBe("010250");
  });

  it("composes category + a 4-digit tail when there is no subcategory", () => {
    expect(composeProductCode("06", "", "0120")).toBe("060120");
  });

  it("yields an empty code when the tail is blank (the code is optional)", () => {
    expect(composeProductCode("06", "01", "")).toBe("");
    expect(composeProductCode("06", "01", "   ")).toBe("");
  });
});
